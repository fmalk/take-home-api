import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from 'sql.js';
import type { Flight, Airport, City, Airline } from './types.js';
import { getDatabase, openDatabase } from '../../../core/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAVEL_DIR = path.resolve(__dirname, '..');

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

  searchFlights(flights: Flight[], from: string, to: string, date: string): Flight[] {
    return flights.filter((f) => f.from === from && f.to === to && f.date === date);
  }

  async getAirports(): Promise<Airport[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare(
      'SELECT iata, icao, name, city, country, country_code, utc_offset, lat, lng, distance_hub, regional, isolated FROM airports',
    );
    const airports: Airport[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      airports.push({
        iata: row.iata as string,
        icao: row.icao as string,
        name: row.name as string,
        city: row.city as string,
        country: row.country as string,
        countryCode: row.country_code as string,
        utcOffset: row.utc_offset as number,
        lat: row.lat as number,
        long: row.lng as number,
        isHub: row.distance_hub as boolean,
        isIsolated: row.isolated as boolean,
        isRegional: row.regional as boolean,
        isStandard: !((row.distance_hub as boolean) || (row.isolated as boolean) || (row.regional as boolean)),
      });
    }
    stmt.free();

    return airports;
  }

  async getAirlines(): Promise<Airline[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare(
      'SELECT iata, icao, name, country, country_code, is_real, low_cost, first_class, business_class, loyalty FROM airlines WHERE is_real = 1', // FIXME: pass as paramenter
    );
    const airlines: Airline[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      airlines.push({
        iata: row.iata as string,
        icao: row.icao as string,
        name: row.name as string,
        country: row.country as string,
        countryCode: row.country_code as string,
        lat: row.lat as number,
        long: row.lng as number,
        isHub: row.distance_hub as boolean,
        hasEconomyClass: row.low_cost as boolean,
        hasBusinessClass: row.business_class as boolean,
        hasFirstClass: row.first_class as boolean,
        hasLoyaltyProgram: row.loyalty as boolean,
      });
    }
    stmt.free();

    return airlines;
  }

  // A regional airline is one whose airport_airlines edge is flagged `regional` for that
  // airport. If the same airline holds a regional edge at both ends, it can fly the pair direct.
  async getRegionalAirlines(from: string, to: string): Promise<Airline[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare(`
      SELECT al.iata, al.icao, al.name, al.country, al.country_code, al.low_cost, al.first_class, al.business_class, al.loyalty
      FROM airport_airlines aa1
      JOIN airport_airlines aa2 ON aa2.airline_iata = aa1.airline_iata
      JOIN airlines al ON al.iata = aa1.airline_iata
      WHERE aa1.airport_iata = :from AND aa1.regional = 1
        AND aa2.airport_iata = :to AND aa2.regional = 1
    `);
    stmt.bind({ ':from': from, ':to': to });

    const airlines: Airline[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      airlines.push({
        iata: row.iata as string,
        icao: row.icao as string,
        name: row.name as string,
        country: row.country as string,
        countryCode: row.country_code as string,
        hasEconomyClass: Boolean(row.low_cost),
        hasBusinessClass: Boolean(row.business_class),
        hasFirstClass: Boolean(row.first_class),
        hasLoyaltyProgram: Boolean(row.loyalty),
      });
    }
    stmt.free();

    return airlines;
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
