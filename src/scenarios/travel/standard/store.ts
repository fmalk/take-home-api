import path from 'path';
import { fileURLToPath } from 'url';
import type { Database } from 'sql.js';
import type { Flight, Airport, City } from './types.js';
import { getDatabase, openDatabase } from '../../../core/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // FIXME: "You need to set the output format to "esm" for "import.meta" to work correctly."
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

    const stmt = db.prepare('SELECT iata, icao, name, city, country, country_code, utc_offset, lat, lng, distance_hub, regional, isolated FROM airports');
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
        isStandard: !(row.distance_hub as boolean || row.isolated as boolean || row.regional as boolean),
      });
    }
    stmt.free();

    return airports;
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
