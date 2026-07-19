import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';
import type { Flight, Route } from './types.js';
import { TravelStore } from './store.js';

const store = new TravelStore();

// Keep this, useful for Faker
function hashFlightQuery(from: string, to: string, date: string): number {
  const str = `${from}|${to}|${date}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function generateId(): string {
  return randomUUID();
}

// `count` will gate how many routes are returned once multi-route/layover logic lands.
export async function findRoutes(from: string, to: string, date: string, _count: number = 10): Promise<Route[]> {
  faker.seed(hashFlightQuery(from, to, date));

  // First pass: only path resolution. A direct flight is possible whenever an airline
  // holds a regional airport_airlines edge at both `from` and `to`; one Route per airline.
  const regionalAirlines = await store.getRegionalAirlines(from, to);

  return regionalAirlines.map((airline) => {
    const flight: Flight = {
      id: generateId(),
      flightTimeHours: 1,
      flightDistanceKms: 100,
      departure: {
        timestamp: date,
        airport: from,
      },
      arrival: {
        timestamp: date,
        airport: to,
      },
      travelInfo: {
        airline: airline.iata,
        plane: '',
        flightNumber: '',
      },
      price: 0,
      pricing: [{ currency: 'USD', regular: 0 }],
      available: 0,
      seats: [{ regular: 0 }],
    };

    return {
      id: generateId(),
      flightTimeHours: flight.flightTimeHours,
      flightDistanceKms: flight.flightDistanceKms,
      departure: flight.departure,
      arrival: flight.arrival,
      flights: [flight],
      available: flight.available,
      price: flight.price,
      pricing: flight.pricing,
    };
  });
}
