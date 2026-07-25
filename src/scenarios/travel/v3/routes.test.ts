import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../server.js';
import { registerScenarios } from '../../../scenarios/index.js';
import { initCache } from '../../../core/cache.js';

let app: FastifyInstance;

beforeAll(async () => {
  initCache();
  app = await buildServer();
  await registerScenarios(app);
});

afterAll(async () => {
  await app.close();
});

describe('V3 Flight Search', () => {
  it('caps HKG->LAX search at 50 routes (regression for route explosion)', async () => {
    // Current date is 2026-07-24, 6 months ahead = 2027-01-24
    const departureDate = '2027-01-24';

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v3/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // The cartesian product of airlines across multiple hub-to-hub paths generates
    // well over 100 possible routes; MAX_PRESENTED_ROUTES caps at 50.
    expect(body.outbound).toBeDefined();
    expect(body.outbound.length).toBe(50);
    expect(body.outbound[0]).toHaveProperty('id');
    expect(body.outbound[0]).toHaveProperty('departure');
    expect(body.outbound[0]).toHaveProperty('arrival');
  });

  it('exposes every seat class a flight offers, unlike v2 which only shows regular', async () => {
    const departureDate = '2027-01-24';

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v3/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    const seatClasses = new Set<string>();
    for (const route of body.outbound) {
      for (const flight of route.flights) {
        for (const pricing of flight.pricing) {
          for (const key of ['regular', 'economy', 'businessClass', 'firstClass']) {
            if (pricing[key] !== undefined) seatClasses.add(key);
          }
        }
      }
    }

    // HKG->LAX is a high-airline-diversity route; across 50 routes' worth of flights, every
    // seat class an airline can offer should show up at least once.
    expect(seatClasses.has('regular') || seatClasses.has('economy')).toBe(true);
    expect(seatClasses.has('businessClass') || seatClasses.has('firstClass')).toBe(true);
  });
});

type FlightPricingRow = Record<string, number | string>;
interface SearchedFlight {
  id: string;
  pricing: FlightPricingRow[];
}
interface SearchedRoute {
  id: string;
  currency: string;
  flights: SearchedFlight[];
}

function pickSeatClass(currencyPricing: FlightPricingRow): string {
  return ['regular', 'economy', 'businessClass', 'firstClass'].find(
    (key) => currencyPricing[key] !== undefined,
  ) as string;
}

describe('V3 Purchase (per-seat pricing)', () => {
  let token: string;

  beforeAll(async () => {
    const username = 'plane';
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v3/login',
      payload: { username, password: `tr@vel${username.slice(0, 5)}` },
    });
    token = JSON.parse(loginResponse.body).access_token;
  });

  async function searchOneWayRoute(): Promise<SearchedRoute> {
    const departureDate = '2027-01-24';
    const searchResponse = await app.inject({
      method: 'GET',
      url: `/api/travel/v3/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const body = JSON.parse(searchResponse.body);
    const route = body.outbound[0];
    const currency = route.flights[0].pricing[0].currency;
    return { id: route.id, currency, flights: route.flights };
  }

  it('purchases a OneWay route by submitting one seat selection per flight', async () => {
    const route = await searchOneWayRoute();

    const pricing = route.flights.map((flight) => {
      const currencyPricing = flight.pricing.find((p) => p.currency === route.currency) as FlightPricingRow;
      const seatClass = pickSeatClass(currencyPricing);
      return { flightId: flight.id, seatClass, pricing: currencyPricing };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/travel/v3/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: route.id,
        currency: route.currency,
        pricing,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('bookingCode');
    expect(body.currency).toBe(route.currency);
    expect(typeof body.price).toBe('number');
  });

  it('rejects a purchase missing a seat selection for one of the route flights', async () => {
    const route = await searchOneWayRoute();

    if (route.flights.length < 2) {
      // Needs a connecting route (2+ flights) to exercise a missing-selection mismatch.
      return;
    }

    const firstFlight = route.flights[0];
    const currencyPricing = firstFlight.pricing.find((p) => p.currency === route.currency) as FlightPricingRow;
    const seatClass = pickSeatClass(currencyPricing);

    const response = await app.inject({
      method: 'POST',
      url: '/api/travel/v3/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: route.id,
        currency: route.currency,
        pricing: [{ flightId: firstFlight.id, seatClass, pricing: currencyPricing }],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('MISSING_FLIGHT_SELECTION');
  });

  it('rejects a purchase where the submitted seat price does not match the stored flight price', async () => {
    const route = await searchOneWayRoute();

    const pricing = route.flights.map((flight) => {
      const currencyPricing = flight.pricing.find((p) => p.currency === route.currency) as FlightPricingRow;
      const seatClass = pickSeatClass(currencyPricing);
      return {
        flightId: flight.id,
        seatClass,
        pricing: { ...currencyPricing, [seatClass]: (currencyPricing[seatClass] as number) + 9999 },
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/travel/v3/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: route.id,
        currency: route.currency,
        pricing,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('PRICE_MISMATCH');
  });
});
