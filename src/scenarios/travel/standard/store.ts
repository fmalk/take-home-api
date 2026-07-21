import path from 'path';
import type { Database } from 'sql.js';
import type { Flight, Airport, City, Airline, Aircraft } from './types.js';
import { getDatabase, openDatabase } from '../../../core/db.js';
import { getEnvBool } from '../../../config/env.js';

// Resolved relative to process.cwd(), not import.meta.url: when esbuild bundles this
// module into a single dist/index.js, import.meta.url points at the bundle's own location
// (dropping the original src/ path), not this file's real path. The Dockerfile already
// assumes cwd-relative resolution — it copies travel.sqlite to src/scenarios/travel/
// alongside dist/, both anchored at WORKDIR /app.
const TRAVEL_DIR = path.resolve(process.cwd(), 'src/scenarios/travel');

// Fixed for the process lifetime, not a per-request option: whether flight/airline data
// draws from real-world airlines (real_airlines.csv) or only the fictional roster
// (fictional_airlines.csv). Set at container build/start time, see Dockerfile.
const USE_REAL_AIRLINES = getEnvBool('TRAVEL_USE_REAL_AIRLINES', false);

export interface ConnectingAirlinesOpts {
  regionalFrom?: boolean;
  regionalTo?: boolean;
}

export interface ReachableAirportsOpts {
  onlyHub?: boolean;
  onlyRegular?: boolean;
  regionalFrom?: boolean;
}

const AIRPORT_COLUMNS =
  'iata, icao, name, city, country, country_code, local_currency, utc_offset, lat, lng, distance_hub, regional, isolated';

function rowToAirport(row: Record<string, unknown>): Airport {
  return {
    iata: row.iata as string,
    icao: row.icao as string,
    name: row.name as string,
    city: row.city as string,
    country: row.country as string,
    countryCode: row.country_code as string,
    localCurrency: row.local_currency as string,
    utcOffset: row.utc_offset as number,
    lat: row.lat as number,
    long: row.lng as number,
    isHub: Boolean(row.distance_hub),
    isIsolated: Boolean(row.isolated),
    isRegional: Boolean(row.regional),
    isStandard: !(row.distance_hub || row.isolated || row.regional),
  };
}

function rowToAirline(row: Record<string, unknown>): Airline {
  return {
    iata: row.iata as string,
    icao: row.icao as string,
    name: row.name as string,
    country: row.country as string,
    countryCode: row.country_code as string,
    hasEconomyClass: Boolean(row.low_cost),
    hasBusinessClass: Boolean(row.business_class),
    hasFirstClass: Boolean(row.first_class),
    hasLoyaltyProgram: Boolean(row.loyalty),
  };
}

function rowToAircraft(row: Record<string, unknown>): Aircraft {
  return {
    manufacturer: row.manufacturer as string,
    model: row.model as string,
    hull: row.type as Aircraft['hull'],
    capacity: row.capacity as number,
  };
}

export class TravelStore {
  constructor() {}

  private async ensureDatabase(): Promise<Database> {
    let db = getDatabase('travel');
    if (!db) {
      db = await openDatabase(TRAVEL_DIR, 'travel');
    }
    return db;
  }

  getFlight(flights: Flight[], id: string): Flight | undefined {
    return flights.find((f) => f.id === id);
  }

  async getAirports(): Promise<Airport[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare(`SELECT ${AIRPORT_COLUMNS} FROM airports`);
    const airports: Airport[] = [];

    while (stmt.step()) {
      airports.push(rowToAirport(stmt.getAsObject()));
    }
    stmt.free();

    return airports;
  }

  async getAirport(iata: string): Promise<Airport | undefined> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare(`SELECT ${AIRPORT_COLUMNS} FROM airports WHERE iata = :iata`);
    stmt.bind({ ':iata': iata });

    let airport: Airport | undefined;
    if (stmt.step()) {
      airport = rowToAirport(stmt.getAsObject());
    }
    stmt.free();

    return airport;
  }

  async getHubs(): Promise<Airport[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare(`SELECT ${AIRPORT_COLUMNS} FROM airports WHERE distance_hub = 1`);
    const airports: Airport[] = [];

    while (stmt.step()) {
      airports.push(rowToAirport(stmt.getAsObject()));
    }
    stmt.free();

    return airports;
  }

  async getAirlines(): Promise<Airline[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare(
      'SELECT iata, icao, name, country, country_code, is_real, low_cost, first_class, business_class, loyalty FROM airlines WHERE is_real = :is_real',
    );
    stmt.bind({ ':is_real': USE_REAL_AIRLINES ? 1 : 0 });
    const airlines: Airline[] = [];

    while (stmt.step()) {
      airlines.push(rowToAirline(stmt.getAsObject()));
    }
    stmt.free();

    return airlines;
  }

  // A regional airline is one whose airport_airlines edge is flagged `regional` for that
  // airport. If the same airline holds a regional edge at both ends, it can fly the pair direct.
  async getRegionalAirlines(from: string, to: string): Promise<Airline[]> {
    return this.getConnectingAirlines(from, to, { regionalFrom: true, regionalTo: true });
  }

  // Airlines that hold an airport_airlines edge at both `from` and `to`. With no opts, any
  // edge counts (regional or premium); pass `regionalFrom`/`regionalTo` to restrict either
  // side to a regional edge (used by getRegionalAirlines and by regional-connector flights).
  async getConnectingAirlines(from: string, to: string, opts: ConnectingAirlinesOpts = {}): Promise<Airline[]> {
    const db = await this.ensureDatabase();

    const conds = ['aa1.airport_iata = :from', 'aa2.airport_iata = :to'];
    if (opts.regionalFrom) conds.push('aa1.regional = 1');
    if (opts.regionalTo) conds.push('aa2.regional = 1');

    const stmt = db.prepare(`
      SELECT DISTINCT al.iata, al.icao, al.name, al.country, al.country_code, al.low_cost, al.first_class, al.business_class, al.loyalty
      FROM airport_airlines aa1
      JOIN airport_airlines aa2 ON aa2.airline_iata = aa1.airline_iata
      JOIN airlines al ON al.iata = aa1.airline_iata
      WHERE ${conds.join(' AND ')}
    `);
    stmt.bind({ ':from': from, ':to': to });

    const airlines: Airline[] = [];
    while (stmt.step()) {
      airlines.push(rowToAirline(stmt.getAsObject()));
    }
    stmt.free();

    return airlines;
  }

  // Every airport reachable from `fromIata` via a single shared-airline edge. Filters:
  //  - onlyHub: destination must be a hub.
  //  - onlyRegular: destination must be standard (not hub/regional/isolated).
  //  - regionalFrom: both edges (origin and destination sides) must be regional — used for
  //    the "regional → regular via regional flight" connector step.
  async getReachableAirports(fromIata: string, opts: ReachableAirportsOpts = {}): Promise<Airport[]> {
    const db = await this.ensureDatabase();

    const conds = ['aa1.airport_iata = :from', 'aa2.airport_iata != aa1.airport_iata'];
    if (opts.regionalFrom) conds.push('aa1.regional = 1', 'aa2.regional = 1');
    if (opts.onlyHub) conds.push('a.distance_hub = 1');
    if (opts.onlyRegular) conds.push('a.distance_hub = 0', 'a.regional = 0', 'a.isolated = 0');

    const stmt = db.prepare(`
      SELECT DISTINCT ${AIRPORT_COLUMNS.split(', ').map((c) => `a.${c}`).join(', ')}
      FROM airport_airlines aa1
      JOIN airport_airlines aa2 ON aa2.airline_iata = aa1.airline_iata
      JOIN airports a ON a.iata = aa2.airport_iata
      WHERE ${conds.join(' AND ')}
    `);
    stmt.bind({ ':from': fromIata });

    const airports: Airport[] = [];
    while (stmt.step()) {
      airports.push(rowToAirport(stmt.getAsObject()));
    }
    stmt.free();

    return airports;
  }

  async getAircraft(): Promise<Aircraft[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare('SELECT manufacturer, model, type, capacity FROM aircraft');
    const aircraft: Aircraft[] = [];

    while (stmt.step()) {
      aircraft.push(rowToAircraft(stmt.getAsObject()));
    }
    stmt.free();

    return aircraft;
  }

  async getCities(): Promise<City[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare('SELECT DISTINCT city, country, country_code FROM airports');
    const cities: City[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      cities.push({
        name: row.city as string,
        country: row.country as string,
        countryCode: row.country_code as string,
      });
    }
    stmt.free();

    return cities;
  }
}
