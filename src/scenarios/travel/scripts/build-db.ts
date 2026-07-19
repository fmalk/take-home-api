import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database, Statement } from 'sql.js';
import { openDatabase, saveDatabase, dropDatabase } from '../../../core/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAVEL_DIR = path.resolve(__dirname, '..');
const DB_NAME = 'travel';

// The longest range we treat as a plausible nonstop for a premium (first/business class)
// widebody service. Pairs further apart than this are considered "too far" for the airline's
// fleet to reach from its headquarters, even though both ends are hubs.
const MAX_HUB_RANGE_KM = 6000;

// Airports within this radius of a hub are close enough for that hub's premium airlines to
// reach as a feeder route. An airport sitting between hubs picks up all.
const REGULAR_AIRPORT_HUB_RADIUS_KM = 3500;

const EARTH_RADIUS_KM = 6371;

interface AirportRow {
  iata: string;
  icao: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  passengersMonthly: number;
  lat: number;
  lng: number;
  utcOffset: number;
  distanceHub: boolean;
  isolated: boolean;
  regional: boolean;
}

interface AirlineRow {
  iata: string;
  icao: string;
  airline: string;
  country: string;
  countryCode: string;
  lowCost: boolean;
  firstClass: boolean;
  businessClass: boolean;
  loyalty: boolean;
}

// Minimal RFC4180-ish CSV parser: handles quoted fields with embedded commas.
function parseCsv(filePath: string): string[][] {
  const content = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n').trim();
  const rows: string[][] = [];

  for (const line of content.split('\n')) {
    const fields: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          field += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(field);
        field = '';
      } else {
        field += char;
      }
    }
    fields.push(field);
    rows.push(fields);
  }

  return rows;
}

function parseAirports(filePath: string): AirportRow[] {
  const [, ...rows] = parseCsv(filePath);
  return rows.map((r) => ({
    iata: r[0],
    icao: r[1],
    name: r[2],
    city: r[3],
    country: r[4],
    countryCode: r[5],
    passengersMonthly: Number(r[6]),
    lat: Number(r[7]),
    lng: Number(r[8]),
    utcOffset: Number(r[9]),
    distanceHub: r[10] === '1',
    isolated: r[11] === '1',
    regional: r[12] === '1',
  }));
}

function parseAirlines(filePath: string): AirlineRow[] {
  const [, ...rows] = parseCsv(filePath);
  return rows.map((r) => ({
    iata: r[0],
    icao: r[1],
    airline: r[2],
    country: r[3],
    countryCode: r[4],
    lowCost: r[5] === '1',
    firstClass: r[6] === '1',
    businessClass: r[7] === '1',
    loyalty: r[8] === '1',
  }));
}

/**
 * Start of Airlines to Airports logic.
 * Fictional and real airlines are two separate rosters, so this is run once per roster.
 * Insertion follow Stages of logic, in the order they run in linkAirportsToAirlines.
 * The goal is to have a reproducible travel.sqlite DB with many possible, realistic routing.
 */

function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Levenshtein edit distance between two strings, used as a deterministic (if arbitrary) way to
// pick "the" airline for a regional airport instead of always taking the first in list.
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) distances[i][0] = i;
  for (let j = 0; j < cols; j++) distances[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(distances[i - 1][j] + 1, distances[i][j - 1] + 1, distances[i - 1][j - 1] + cost);
    }
  }

  return distances[a.length][b.length];
}

// Groups two-column SQL result rows (e.g. `SELECT airport_iata, airline_iata FROM ...`) into a
// Map from the first column to every distinct second-column value seen with it. Deduped because
// airport_airlines' PK includes `regional`, so the same (airport, airline) pair can legitimately
// appear twice — once as a regional edge, once as a non-regional one.
function groupByFirstColumn(rows: [string, string][]): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const [key, value] of rows) {
    const values = grouped.get(key);
    if (values) {
      values.add(value);
    } else {
      grouped.set(key, new Set([value]));
    }
  }
  return new Map([...grouped].map(([key, values]) => [key, [...values]]));
}

// Stage 1 - domestic: every (non-isolated) airport is served by every airline headquartered in
// the same country. Regional airports only get one (any country with no domestic airline in
// this roster contributes nothing, rather than crashing).
function linkDomesticAirlines(insertLink: Statement, airports: AirportRow[], roster: AirlineRow[]): void {
  for (const airport of airports) {
    if (airport.isolated) continue;

    const domesticAirlines = roster.filter((a) => a.countryCode === airport.countryCode);
    const airlinesToLink = airport.regional ? domesticAirlines.slice(0, 1) : domesticAirlines;

    for (const airline of airlinesToLink) {
      insertLink.run({ ':airport_iata': airport.iata, ':airline_iata': airline.iata, ':regional': 1 });
    }
  }
}

// An airline's headquarters is deterministically the busiest airport in its home country,
// preferring a distance hub if the country has one.
function findAirlineHeadquarters(airports: AirportRow[], airline: AirlineRow): AirportRow | undefined {
  const domesticAirports = airports.filter((a) => a.countryCode === airline.countryCode);
  const domesticHubs = domesticAirports.filter((a) => a.distanceHub);
  const candidates = domesticHubs.length > 0 ? domesticHubs : domesticAirports;

  return candidates.reduce<AirportRow | undefined>((busiest, candidate) => {
    if (!busiest || candidate.passengersMonthly > busiest.passengersMonthly) return candidate;
    return busiest;
  }, undefined);
}

// Stage 2 - Hubs: hubs are served by every BusinessClass airline, unless the hub is out of
// nonstop range from the airline's headquarters. Not considered regional edges.
function linkHubAirlines(insertLink: Statement, airports: AirportRow[], roster: AirlineRow[]): void {
  const hubs = airports.filter((a) => a.distanceHub);
  const businessAirlines = roster.filter((a) => a.businessClass);

  for (const airline of businessAirlines) {
    const headquarters = findAirlineHeadquarters(airports, airline);
    if (!headquarters) continue;

    for (const hub of hubs) {
      if (haversineDistanceKm(headquarters, hub) > MAX_HUB_RANGE_KM) continue;

      insertLink.run({ ':airport_iata': hub.iata, ':airline_iata': airline.iata, ':regional': 0 });
    }
  }
}

// Stage 2b - First class: FirstClass airlines are more exclusive than BusinessClass ones, and are
// restricted to hubs in the airline's own home country only (no cross-border reach, no distance
// check — home country hubs are all fair game regardless of how far apart they are).
function linkFirstClassHubAirlines(insertLink: Statement, airports: AirportRow[], roster: AirlineRow[]): void {
  const hubs = airports.filter((a) => a.distanceHub);
  const firstClassAirlines = roster.filter((a) => a.firstClass);

  for (const airline of firstClassAirlines) {
    const domesticHubs = hubs.filter((h) => h.countryCode === airline.countryCode);
    for (const hub of domesticHubs) {
      insertLink.run({ ':airport_iata': hub.iata, ':airline_iata': airline.iata, ':regional': 0 });
    }
  }
}

// Groups hubs into connected components given a hub-iata adjacency map, largest component first.
function getConnectedComponents(hubs: AirportRow[], adjacency: Map<string, Set<string>>): AirportRow[][] {
  const byIata = new Map(hubs.map((h) => [h.iata, h]));
  const visited = new Set<string>();
  const components: AirportRow[][] = [];

  for (const start of hubs) {
    if (visited.has(start.iata)) continue;

    const component: AirportRow[] = [];
    const queue = [start.iata];
    visited.add(start.iata);

    while (queue.length > 0) {
      const currentIata = queue.shift()!;
      const current = byIata.get(currentIata);
      if (current) component.push(current);

      for (const neighborIata of adjacency.get(currentIata) ?? []) {
        if (!visited.has(neighborIata)) {
          visited.add(neighborIata);
          queue.push(neighborIata);
        }
      }
    }
    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length);
}

// Builds the hub-to-hub adjacency implied by the current DB state: two hubs are adjacent if some
// non-regional airline serves both.
function getHubAdjacency(
  db: Database,
  hubs: AirportRow[],
): { airlinesByHub: Map<string, string[]>; adjacency: Map<string, Set<string>> } {
  const rows = db.exec(`
        SELECT aa.airport_iata, aa.airline_iata
        FROM airport_airlines aa
        JOIN airports a ON a.iata = aa.airport_iata
        WHERE a.distance_hub = 1 AND aa.regional = 0
    `);
  const airlinesByHub = groupByFirstColumn((rows[0]?.values ?? []) as [string, string][]);

  const hubsByAirline = new Map<string, string[]>();
  for (const [hub, airlines] of airlinesByHub) {
    for (const airline of airlines) {
      const served = hubsByAirline.get(airline);
      if (served) served.push(hub);
      else hubsByAirline.set(airline, [hub]);
    }
  }

  const adjacency = new Map<string, Set<string>>(hubs.map((h) => [h.iata, new Set<string>()]));
  for (const served of hubsByAirline.values()) {
    for (const a of served) {
      for (const b of served) {
        if (a !== b) adjacency.get(a)?.add(b);
      }
    }
  }

  return { airlinesByHub, adjacency };
}

// Stage 2c - Hub bridging: some hubs (e.g. a remote island hub like HNL) may end up with no
// in-range headquarters at all, leaving them disconnected from the rest of the hub network. Bridge
// each disconnected cluster to the main one by sharing the closest main-cluster hub's airlines with
// the closest hub in the isolated cluster, so every hub stays reachable from every other hub via
// some sequence of shared-airline legs (changing airlines between legs is fine).
function bridgeIsolatedHubClusters(db: Database, insertLink: Statement, hubs: AirportRow[]): void {
  for (let i = 0; i < hubs.length; i++) {
    const { airlinesByHub, adjacency } = getHubAdjacency(db, hubs);
    const components = getConnectedComponents(hubs, adjacency);
    if (components.length <= 1) return;

    const [mainCluster, island] = components;

    let bridge: { main: AirportRow; isolated: AirportRow; distance: number } | undefined;
    for (const mainHub of mainCluster) {
      for (const isolatedHub of island) {
        const distance = haversineDistanceKm(mainHub, isolatedHub);
        if (!bridge || distance < bridge.distance) bridge = { main: mainHub, isolated: isolatedHub, distance };
      }
    }
    if (!bridge) return;

    for (const airlineIata of airlinesByHub.get(bridge.main.iata) ?? []) {
      insertLink.run({ ':airport_iata': bridge.isolated.iata, ':airline_iata': airlineIata, ':regional': 0 });
    }
  }
}

// Stage 2d - Trans-Pacific override: Honolulu sits just past every headquarters' nonstop range
// (Tokyo is the closest at ~6200km, just over MAX_HUB_RANGE_KM), so Stage 2c's general bridging
// connects it via the mainland US instead. A Hawaii-Japan route is a real, important Pacific
// crossing though, so explicitly add Japan's own premium airlines to HNL on top of that bridge —
// deliberately narrower than a range-based fix, which would also pull in several unrelated
// long-haul pairs elsewhere in the 6000-6500km band.
function linkJapanToHonolulu(insertLink: Statement, airports: AirportRow[], roster: AirlineRow[]): void {
  const hnl = airports.find((a) => a.iata === 'HNL' && a.distanceHub);
  if (!hnl) return;

  const japaneseBusinessAirlines = roster.filter((a) => a.countryCode === 'JP' && (a.businessClass || a.firstClass));
  for (const airline of japaneseBusinessAirlines) {
    insertLink.run({ ':airport_iata': hnl.iata, ':airline_iata': airline.iata, ':regional': 0 });
  }
}

// Every hub must be reachable from every other hub via some sequence of shared-airline legs
// (changing airlines between legs is fine) — otherwise a hub-to-hub route would be
// impossible to construct. This is a build-time safety net, not a fix: if it throws, the CSV
// data (or MAX_HUB_RANGE_KM) needs revisiting.
function assertHubGraphConnected(db: Database, hubs: AirportRow[]): void {
  const { adjacency } = getHubAdjacency(db, hubs);
  const components = getConnectedComponents(hubs, adjacency);

  if (components.length > 1) {
    const clusters = components.map((c) => `[${c.map((h) => h.iata).join(', ')}]`).join(' vs. ');
    throw new Error(
      `Stage 2 left the hub network split into ${components.length} disconnected cluster(s): ${clusters}`,
    );
  }
}

// Stage 3 - Regular airports: every non-hub, non-regional-flagged airport connects to every hub
// within range, extending that hub's already-linked non-regional (premium) airlines out to it —
// but only the ones whose own headquarters is still within MAX_HUB_RANGE_KM of the regular
// airport itself. Without that check, an airline that just barely reaches a hub (e.g. a North
// American carrier reaching MAO) would leak into every regular airport near that hub too, even
// ones much closer to a different hub the airline can't reach at all (e.g. CNF, right next to
// GRU, inheriting American/Air Canada via the more distant MAO). An airport with no hub in range
// still gets its single closest hub, so nothing is left unreachable. Regional-flagged airports are
// deliberately out of scope here — Stage 1 already gives them their one domestic airline, and any
// further reach is a later stage's call.
function linkRegularAirportsToHubs(
  db: Database,
  insertLink: Statement,
  airports: AirportRow[],
  roster: AirlineRow[],
): void {
  const hubs = airports.filter((a) => a.distanceHub);
  const regularAirports = airports.filter((a) => !a.distanceHub);

  const hubLinkRows = db.exec(`
        SELECT airport_iata, airline_iata FROM airport_airlines WHERE regional = 0
    `);
  const airlinesByHub = groupByFirstColumn((hubLinkRows[0]?.values ?? []) as [string, string][]);

  const airlinesByIata = new Map(roster.map((a) => [a.iata, a]));
  const headquartersByIata = new Map(
    roster.map((a) => [a.iata, findAirlineHeadquarters(airports, a)] as const).filter(([, hq]) => hq !== undefined),
  );

  for (const airport of regularAirports) {
    const hubsByDistance = hubs
      .map((hub) => ({ hub, distance: haversineDistanceKm(airport, hub) }))
      .sort((a, b) => a.distance - b.distance);

    const inRange = hubsByDistance.filter((hd) => hd.distance <= REGULAR_AIRPORT_HUB_RADIUS_KM).map((hd) => hd.hub);
    const targetHubs = inRange.length > 0 ? inRange : hubsByDistance.slice(0, 1).map((hd) => hd.hub);

    for (const hub of targetHubs) {
      for (const airlineIata of airlinesByHub.get(hub.iata) ?? []) {
        if (!airlinesByIata.has(airlineIata)) continue;

        const headquarters = headquartersByIata.get(airlineIata);
        if (!headquarters || haversineDistanceKm(headquarters, airport) > MAX_HUB_RANGE_KM) continue;

        // this will be considered a regional serving
        insertLink.run({ ':airport_iata': airport.iata, ':airline_iata': airlineIata, ':regional': 1 });
      }
    }
  }
}

// Stage 4 - Last mile: every regional airport, whether or not it already has an airline from
// Stage 1, picks up exactly one more airline sourced from its closest regular (non-regional-
// flagged) airport. Among that airport's already-linked airlines, we deterministically pick
// the one whose name is lexically closest (by Levenshtein distance) to the regional airport's
// name, rather than an arbitrary "first in list" pick.
function linkLastMileAirlines(
  db: Database,
  insertLink: Statement,
  regularAirports: AirportRow[],
  regionalAirports: AirportRow[],
): void {
  const airlineNameRows = db.exec('SELECT iata, name FROM airlines');
  const airlineNames = new Map<string, string>();
  for (const [iata, name] of (airlineNameRows[0]?.values ?? []) as [string, string][]) {
    airlineNames.set(iata, name);
  }

  const linkRows = db.exec('SELECT airport_iata, airline_iata FROM airport_airlines');
  const airlinesByAirport = groupByFirstColumn((linkRows[0]?.values ?? []) as [string, string][]);

  for (const regionalAirport of regionalAirports) {
    const closest = regularAirports.reduce<{ airport: AirportRow; distance: number } | undefined>(
      (nearest, candidate) => {
        const distance = haversineDistanceKm(regionalAirport, candidate);
        if (!nearest || distance < nearest.distance) return { airport: candidate, distance };
        return nearest;
      },
      undefined,
    );
    if (!closest) continue;

    const servedAirlineIatas = airlinesByAirport.get(closest.airport.iata) ?? [];
    if (servedAirlineIatas.length === 0) continue;

    const bestAirlineIata = [...servedAirlineIatas]
      .sort()
      .reduce<{ iata: string; distance: number } | undefined>((best, iata) => {
        const distance = levenshteinDistance(regionalAirport.name, airlineNames.get(iata) ?? '');
        if (!best || distance < best.distance) return { iata, distance };
        return best;
      }, undefined);
    if (!bestAirlineIata) continue;

    insertLink.run({ ':airport_iata': regionalAirport.iata, ':airline_iata': bestAirlineIata.iata, ':regional': 1 });
  }
}

// Every non-isolated airport must end up with at least one airline once all stages have run, or
// a route touching it would be impossible to construct. Isolated airports are the only ones
// intentionally left unserved.
function assertOnlyIsolatedAirportsUnserved(db: Database, airports: AirportRow[]): void {
  const rows = db.exec('SELECT DISTINCT airport_iata FROM airport_airlines');
  const served = new Set((rows[0]?.values ?? []).map(([iata]) => iata as string));

  const unserved = airports.filter((a) => !a.isolated && !served.has(a.iata)).map((a) => a.iata);

  if (unserved.length > 0) {
    throw new Error(`${unserved.length} non-isolated airport(s) were left without any airline: ${unserved.join(', ')}`);
  }
}

function linkAirportsToAirlines(
  db: Database,
  airports: AirportRow[],
  fictionalAirlines: AirlineRow[],
  realAirlines: AirlineRow[],
): void {
  const insertLink = db.prepare(`
        INSERT OR IGNORE INTO airport_airlines (airport_iata, airline_iata, regional)
        VALUES (:airport_iata, :airline_iata, :regional)
    `);

  // isolated airports are intentionally left with no flights and take no part in any stage.
  const linkableAirports = airports.filter((a) => !a.isolated);
  const normalAirports = linkableAirports.filter((a) => !a.regional);
  const regionalAirports = linkableAirports.filter((a) => a.regional);

  // Stage 1
  linkDomesticAirlines(insertLink, linkableAirports, fictionalAirlines);
  linkDomesticAirlines(insertLink, linkableAirports, realAirlines);

  // Stage 2
  linkHubAirlines(insertLink, linkableAirports, fictionalAirlines);
  linkHubAirlines(insertLink, linkableAirports, realAirlines);

  // Stage 2b
  linkFirstClassHubAirlines(insertLink, linkableAirports, fictionalAirlines);
  linkFirstClassHubAirlines(insertLink, linkableAirports, realAirlines);

  // Stage 2c
  const hubs = linkableAirports.filter((a) => a.distanceHub);
  bridgeIsolatedHubClusters(db, insertLink, hubs);

  // Stage 2d
  linkJapanToHonolulu(insertLink, linkableAirports, fictionalAirlines);
  linkJapanToHonolulu(insertLink, linkableAirports, realAirlines);

  assertHubGraphConnected(db, hubs);

  // Stage 3
  linkRegularAirportsToHubs(db, insertLink, normalAirports, [...fictionalAirlines, ...realAirlines]);

  // Stage 4
  linkLastMileAirlines(db, insertLink, normalAirports, regionalAirports);

  assertOnlyIsolatedAirportsUnserved(db, airports);

  insertLink.free();
}

async function buildDb(): Promise<void> {
  const airports = parseAirports(path.join(TRAVEL_DIR, 'airports.csv'));
  const fictionalAirlines = parseAirlines(path.join(TRAVEL_DIR, 'fictional_airlines.csv'));
  const realAirlines = parseAirlines(path.join(TRAVEL_DIR, 'real_airlines.csv'));

  await dropDatabase(DB_NAME);
  const dbPath = path.join(TRAVEL_DIR, `${DB_NAME}.sqlite`);
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const db = await openDatabase(TRAVEL_DIR, DB_NAME);

  db.run(`
        CREATE TABLE airports (
            iata TEXT PRIMARY KEY,
            icao TEXT NOT NULL,
            name TEXT NOT NULL,
            city TEXT NOT NULL,
            country TEXT NOT NULL,
            country_code TEXT NOT NULL,
            passengers_monthly REAL NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            utc_offset REAL NOT NULL,
            distance_hub INTEGER NOT NULL,
            isolated INTEGER NOT NULL,
            regional INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_airports_icao ON airports (icao);

        CREATE TABLE airlines (
            iata TEXT PRIMARY KEY,
            icao TEXT NOT NULL,
            name TEXT NOT NULL,
            country TEXT NOT NULL,
            country_code TEXT NOT NULL,
            is_real INTEGER NOT NULL,
            low_cost INTEGER NOT NULL,
            first_class INTEGER NOT NULL,
            business_class INTEGER NOT NULL,
            loyalty INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_airlines_icao ON airlines (icao);

        CREATE TABLE airport_airlines (
            airport_iata TEXT NOT NULL REFERENCES airports (iata),
            airline_iata TEXT NOT NULL REFERENCES airlines (iata),
            regional INTEGER NOT NULL,
            PRIMARY KEY (airport_iata, airline_iata, regional) -- regional needed to account for airlines serving both
        );

        CREATE INDEX idx_airport_airlines_airline ON airport_airlines (airline_iata);
    `);

  const insertAirport = db.prepare(`
        INSERT INTO airports (iata, icao, name, city, country, country_code, passengers_monthly, lat, lng, utc_offset, distance_hub, isolated, regional)
        VALUES (:iata, :icao, :name, :city, :country, :country_code, :passengers_monthly, :lat, :lng, :utc_offset, :distance_hub, :isolated, :regional)
    `);
  for (const a of airports) {
    insertAirport.run({
      ':iata': a.iata,
      ':icao': a.icao,
      ':name': a.name,
      ':city': a.city,
      ':country': a.country,
      ':country_code': a.countryCode,
      ':passengers_monthly': a.passengersMonthly,
      ':lat': a.lat,
      ':lng': a.lng,
      ':utc_offset': a.utcOffset,
      ':distance_hub': a.distanceHub ? 1 : 0,
      ':isolated': a.isolated ? 1 : 0,
      ':regional': a.regional ? 1 : 0,
    });
  }
  insertAirport.free();

  const insertAirline = db.prepare(`
        INSERT INTO airlines (iata, icao, name, country, country_code, is_real, low_cost, first_class, business_class, loyalty)
        VALUES (:iata, :icao, :name, :country, :country_code, :is_real, :low_cost, :first_class, :business_class, :loyalty)
    `);
  for (const airline of fictionalAirlines) {
    insertAirline.run({
      ':iata': airline.iata,
      ':icao': airline.icao,
      ':name': airline.airline,
      ':country': airline.country,
      ':country_code': airline.countryCode,
      ':is_real': 0,
      ':low_cost': airline.lowCost ? 1 : 0,
      ':first_class': airline.firstClass ? 1 : 0,
      ':business_class': airline.businessClass ? 1 : 0,
      ':loyalty': airline.loyalty ? 1 : 0,
    });
  }
  for (const airline of realAirlines) {
    insertAirline.run({
      ':iata': airline.iata,
      ':icao': airline.icao,
      ':name': airline.airline,
      ':country': airline.country,
      ':country_code': airline.countryCode,
      ':is_real': 1,
      ':low_cost': airline.lowCost ? 1 : 0,
      ':first_class': airline.firstClass ? 1 : 0,
      ':business_class': airline.businessClass ? 1 : 0,
      ':loyalty': airline.loyalty ? 1 : 0,
    });
  }
  insertAirline.free();

  linkAirportsToAirlines(db, airports, fictionalAirlines, realAirlines);

  await saveDatabase(TRAVEL_DIR, DB_NAME);
  await dropDatabase(DB_NAME);

  console.log(`Built ${dbPath}`);
  console.log(`  airports: ${airports.length}`);
  console.log(`  airlines: ${fictionalAirlines.length} fictional + ${realAirlines.length} real`);
  console.log(`  airport_airlines: possible airline flights between airports`);
  console.log(`  isolated airports (no flights): ${airports.filter((a) => a.isolated).length}`);
  console.log(`  regional airports (few airlines): ${airports.filter((a) => a.regional).length}`);
}

buildDb().catch((err) => {
  console.error(err);
  process.exit(1);
});
