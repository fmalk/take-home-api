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

// Stage 1 - regional: every airport is served by every airline headquartered in the
// same country, regardless of MIN/MAX. Fictional and real airlines are two separate
// rosters, so this is run once per roster.
function linkRegionalAirlines(insertLink: Statement, airports: AirportRow[], roster: AirlineRow[]): void {
  for (const airport of airports) {
    const regionalAirlines = roster.filter((a) => a.countryCode === airport.countryCode);

    for (const airline of regionalAirlines) {
      insertLink.run({ ':airport_iata': airport.iata, ':airline_iata': airline.iata, ':regional': 1 });
    }
  }
}

function linkAirportsToAirlines(db: Database, airports: AirportRow[], fictionalAirlines: AirlineRow[], realAirlines: AirlineRow[]): void {
  const insertLink = db.prepare(`
        INSERT INTO airport_airlines (airport_iata, airline_iata, regional)
        VALUES (:airport_iata, :airline_iata, :regional)
    `);

  linkRegionalAirlines(insertLink, airports, fictionalAirlines);
  linkRegionalAirlines(insertLink, airports, realAirlines);

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
            distance_hub INTEGER NOT NULL
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
        INSERT INTO airports (iata, icao, name, city, country, country_code, passengers_monthly, lat, lng, utc_offset, distance_hub)
        VALUES (:iata, :icao, :name, :city, :country, :country_code, :passengers_monthly, :lat, :lng, :utc_offset, :distance_hub)
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
}

buildDb().catch((err) => {
  console.error(err);
  process.exit(1);
});
