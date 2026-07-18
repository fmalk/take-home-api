import { TravelStore } from './store.js';
import type { Flight } from './types.js';

// getFlight is a pure array operation with no database dependency. Methods that
// hit the sqlite-backed store (getAirports, getCities) are covered once
// scenario-level test infra with a db fixture exists.
//
// Not covered here: searchFlights filters on f.from/f.to/f.date, which don't
// exist on Flight (see tsc errors) — it's dead code, unused outside this file.

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: 'flight-1',
    flightTimeHours: 2,
    flightDistanceKms: 1000,
    departure: { timestamp: '2026-01-01T08:00:00Z', airport: 'JFK' },
    arrival: { timestamp: '2026-01-01T10:00:00Z', airport: 'LAX' },
    travelInfo: { airline: 'AA', plane: '737', flightNumber: 'AA100' },
    price: 199,
    pricing: [{ currency: 'USD', regular: 199 }],
    available: 10,
    seats: [{ regular: 10 }],
    ...overrides,
  };
}

describe('TravelStore', () => {
  const store = new TravelStore();

  describe('getFlight', () => {
    it('returns the flight matching the given id', () => {
      const target = makeFlight({ id: 'flight-2' });
      const flights = [makeFlight({ id: 'flight-1' }), target];

      expect(store.getFlight(flights, 'flight-2')).toBe(target);
    });

    it('returns undefined when no flight matches', () => {
      const flights = [makeFlight({ id: 'flight-1' })];

      expect(store.getFlight(flights, 'missing')).toBeUndefined();
    });
  });
});
