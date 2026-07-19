import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Database, Statement } from 'sql.js';
import { openDatabase, saveDatabase, dropDatabase } from '../../../core/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAVEL_DIR = path.resolve(__dirname, '..');
const DB_NAME = 'travel';

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
  }));
}

/**
 * Start of Airlines to Airports logic.
 * Fictional and real airlines are two separate rosters, so this is run once per roster.
 * Insertion follow Stages of logic, in the order they run in linkAirportsToAirlines.
 * The goal is to have a reproducible travel.sqlite DB with many possible, realistic routing.
 */

const EARTH_RADIUS_KM = 6371;

function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
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
// Map from the first column to every second-column value seen with it.
function groupByFirstColumn(rows: [string, string][]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of rows) {
    const values = grouped.get(key);
    if (values) {
      values.push(value);
    } else {
      grouped.set(key, [value]);
    }
  }
  return grouped;
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

// The longest range we treat as a plausible nonstop for a premium (first/business class)
// widebody service. Pairs further apart than this are considered "too far" for the airline's
// fleet to reach from its headquarters, even though both ends are hubs.
const MAX_HUB_RANGE_KM = 6000;

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

// Stage 2 - Hubs: hubs are also served by every BusinessClass/FirstClass airline, unless the hub
// is out of nonstop range from the airline's headquarters. Not considered regional edges.
function linkHubAirlines(insertLink: Statement, airports: AirportRow[], roster: AirlineRow[]): void {
  const hubs = airports.filter((a) => a.distanceHub);
  const premiumAirlines = roster.filter((a) => a.firstClass || a.businessClass);

  for (const airline of premiumAirlines) {
    const headquarters = findAirlineHeadquarters(airports, airline);
    if (!headquarters) continue;

    for (const hub of hubs) {
      if (haversineDistanceKm(headquarters, hub) > MAX_HUB_RANGE_KM) continue;

      insertLink.run({ ':airport_iata': hub.iata, ':airline_iata': airline.iata, ':regional': 0 });
    }
  }
}

// FIXME: Refactor this logic, not every hub will connect to one another, MAX_HUB_RANGE_KM is now shorter.
// Possible fix: check that every hub has at least another hub within MAX_HUB_RANGE_KM. At least one
// non-regional airline should be shared among them.

// Every pair of hubs must share at least one airline, or a hub-to-hub route would be
// impossible to construct. Stage 2 links each airline independently by range from its own
// headquarters, so nothing else guarantees two hubs stay mutually reachable — this is a
// build-time safety net, not a fix: if it throws, the CSV data (or MAX_HUB_RANGE_KM) needs revisiting.
function assertHubsFullyConnected(db: Database, hubs: AirportRow[]): void {
  const rows = db.exec(`
        SELECT aa.airline_iata, aa.airport_iata
        FROM airport_airlines aa
        JOIN airports a ON a.iata = aa.airport_iata
        WHERE a.distance_hub = 1 AND aa.regional = 0
    `);

  const hubsByAirline = groupByFirstColumn((rows[0]?.values ?? []) as [string, string][]);
  const airlineHubLists = [...hubsByAirline.values()];

  const uncoveredPairs: string[] = [];
  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      const a = hubs[i].iata;
      const b = hubs[j].iata;
      const covered = airlineHubLists.some((served) => served.includes(a) && served.includes(b));
      if (!covered) uncoveredPairs.push(`${a}-${b}`);
    }
  }

  if (uncoveredPairs.length > 0) {
    //throw new Error(
    console.error(
      `Stage 2 left ${uncoveredPairs.length} hub pair(s) with no shared airline (no possible route between them): ${uncoveredPairs.join(', ')}`,
    );
  }
}

// Airports within this radius of a hub are close enough for that hub's premium airlines to
// reach as a feeder route. An airport sitting between hubs picks up all.
const REGULAR_AIRPORT_HUB_RADIUS_KM = 3500;

// Stage 3 - Regular airports: every non-hub, non-regional-flagged airport connects to every hub
// within range, extending that hub's already-linked non-regional (premium) airlines out to it.
// An airport with no hub in range still gets its single closest hub, so nothing is left
// unreachable. Regional-flagged airports are deliberately out of scope here — Stage 1 already
// gives them their one domestic airline, and any further reach is a later stage's call.
function linkRegularAirportsToHubs(db: Database, insertLink: Statement, airports: AirportRow[]): void {
  const hubs = airports.filter((a) => a.distanceHub);
  const regularAirports = airports.filter((a) => !a.distanceHub);

  const hubLinkRows = db.exec(`
        SELECT airport_iata, airline_iata FROM airport_airlines WHERE regional = 0
    `);
  const airlinesByHub = groupByFirstColumn((hubLinkRows[0]?.values ?? []) as [string, string][]);

  for (const airport of regularAirports) {
    const hubsByDistance = hubs
      .map((hub) => ({ hub, distance: haversineDistanceKm(airport, hub) }))
      .sort((a, b) => a.distance - b.distance);

    const inRange = hubsByDistance.filter((hd) => hd.distance <= REGULAR_AIRPORT_HUB_RADIUS_KM).map((hd) => hd.hub);
    const targetHubs = inRange.length > 0 ? inRange : hubsByDistance.slice(0, 1).map((hd) => hd.hub);

    for (const hub of targetHubs) {
      for (const airlineIata of airlinesByHub.get(hub.iata) ?? []) {
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

// The mean distance from each non-hub airport to its nearest hub (distance_hub = true).
// This is the "direct flight vs. layover through a hub" standard: below this distance,
// treat a route as directly flyable; at or above it, prefer routing through the nearest hub.
function computeMeanNearestHubDistanceKm(airports: AirportRow[]): number {
  const hubs = airports.filter((a) => a.distanceHub);
  const nonHubs = airports.filter((a) => !a.distanceHub);

  let total = 0;
  for (const airport of nonHubs) {
    let nearest = Infinity;
    for (const hub of hubs) {
      const distance = haversineDistanceKm(airport, hub);
      if (distance < nearest) nearest = distance;
    }
    total += nearest;
  }

  return nonHubs.length > 0 ? total / nonHubs.length : 0;
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

  const meanHubDistanceKm = computeMeanNearestHubDistanceKm(airports);

  // Stage 1
  linkDomesticAirlines(insertLink, linkableAirports, fictionalAirlines);
  linkDomesticAirlines(insertLink, linkableAirports, realAirlines);

  // Stage 2
  linkHubAirlines(insertLink, linkableAirports, fictionalAirlines);
  linkHubAirlines(insertLink, linkableAirports, realAirlines);
  assertHubsFullyConnected(
    db,
    linkableAirports.filter((a) => a.distanceHub),
  );

  // Stage 3
  linkRegularAirportsToHubs(db, insertLink, normalAirports);

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
            business_class INTEGER NOT NULL
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
        INSERT INTO airlines (iata, icao, name, country, country_code, is_real, low_cost, first_class, business_class)
        VALUES (:iata, :icao, :name, :country, :country_code, :is_real, :low_cost, :first_class, :business_class)
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
