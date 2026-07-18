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
 * Insertion follow Stages of logic.
 */

const EARTH_RADIUS_KM = 6371;

function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
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

// Stage 1 - domestic: every (non-isolated) airport is served by every airline headquartered in the same country.
function linkDomesticAirlines(insertLink: Statement, airports: AirportRow[], roster: AirlineRow[]): void {
  for (const airport of airports) {
    const domesticAirlines = roster.filter((a) => a.countryCode === airport.countryCode);

    if (airport.isolated) {
      // don't relate airlines here
    } else if (airport.regional) {
      const airline = domesticAirlines[0];
      if (airline) {
        insertLink.run({ ':airport_iata': airport.iata, ':airline_iata': airline.iata, ':regional': 1 });
      }
    } else {
      for (const airline of domesticAirlines) {
        insertLink.run({ ':airport_iata': airport.iata, ':airline_iata': airline.iata, ':regional': 1 });
      }
    }
  }
}

// The longest range we treat as a plausible nonstop for a premium (first/business class)
// widebody service. Pairs further apart than this are considered "too far" for the airline's
// fleet to reach from its headquarters, even though both ends are hubs.
const MAX_HUB_RANGE_KM = 14000;

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

  const hubsByAirline = new Map<string, Set<string>>();
  for (const [airlineIata, airportIata] of (rows[0]?.values ?? []) as [string, string][]) {
    let served = hubsByAirline.get(airlineIata);
    if (!served) {
      served = new Set<string>();
      hubsByAirline.set(airlineIata, served);
    }
    served.add(airportIata);
  }

  const airlineHubSets = [...hubsByAirline.values()];
  const uncoveredPairs: string[] = [];
  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      const a = hubs[i].iata;
      const b = hubs[j].iata;
      const covered = airlineHubSets.some((served) => served.has(a) && served.has(b));
      if (!covered) uncoveredPairs.push(`${a}-${b}`);
    }
  }

  if (uncoveredPairs.length > 0) {
    throw new Error(
      `Stage 2 left ${uncoveredPairs.length} hub pair(s) with no shared airline (no possible route between them): ${uncoveredPairs.join(', ')}`,
    );
  }
}

// Stage 3 - close cross border: airport pairs in different countries but within the
// mean nearest-hub distance are connected with the union of airlines already serving
// either side (e.g. from Stage 1). Still considered regional edges.
function linkCrossBorderAirlines(insertLink: Statement, airports: AirportRow[], roster: AirlineRow[]): void {}

// Stage 4 - Last Mile Airports: Airports without Airlines yet should be served by ONE close regional airline.
// TODO: define in a future pass.
function linkLastMileAirlines(): void {}

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
  linkCrossBorderAirlines(insertLink, normalAirports, meanHubDistanceKm);

  // Stage 4
  linkLastMileAirlines();

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
            PRIMARY KEY (airport_iata, airline_iata)
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
  console.log(`  airport_airlines: regional (same-country) fictional + real airlines per airport`);
  console.log(`  isolated airports (no flights): ${airports.filter((a) => a.isolated).length}`);
  console.log(`  regional airports (single roster airline): ${airports.filter((a) => a.regional).length}`);
}

buildDb().catch((err) => {
  console.error(err);
  process.exit(1);
});
