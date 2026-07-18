import path from 'path';
import { fileURLToPath } from 'url';
import type { Flight, Airport, City } from '../types/index.js';
import { getDatabase, openDatabase } from '../../../core/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAVEL_DIR = path.resolve(__dirname, '..');

export class TravelStore {
  constructor() {}

  private async ensureDatabase() {
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

    const stmt = db.prepare('SELECT iata, name, city, country FROM airports');
    const airports: Airport[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      airports.push({
        iata: row.iata as string,
        name: row.name as string,
        city: row.city as string,
        country: row.country as string,
      });
    }
    stmt.free();

    return airports;
  }

  async getCities(): Promise<City[]> {
    const db = await this.ensureDatabase();

    const stmt = db.prepare('SELECT DISTINCT city, country FROM airports');
    const cities: City[] = [];

    while (stmt.step()) {
      const row = stmt.getAsObject();
      cities.push({
        name: row.city as string,
        country: row.country as string,
      });
    }
    stmt.free();

    return cities;
  }
}
