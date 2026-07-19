import { faker } from '@faker-js/faker';
import type { Flight, Route } from '../standard/types.js';

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

// TODO: UUID is fine here
export function generateId(): string {
  return Math.random().toString(); // FIXME
}

export function findRoutes(from: string, to: string, date: string, count: number = 10): Route[] {
  faker.seed(hashFlightQuery(from, to, date));

  const flights: Flight[] = [];

  // TODO: logic using airport_airlines
  return [{
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
    flights,
    available: 10;
    price: 10;
    pricing: [];
  }];
}
