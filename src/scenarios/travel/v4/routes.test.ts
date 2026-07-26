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

describe('V4 Flight Search', () => {
  it('caps HKG->LAX search at 50 routes across pages, 15 per page (regression for route explosion)', async () => {
    // Current date is 2026-07-24, 6 months ahead = 2027-01-24
    const departureDate = '2027-01-24';

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // The cartesian product of airlines across multiple hub-to-hub paths generates
    // well over 100 possible routes; MAX_PRESENTED_ROUTES caps at 50, paginated 15 per page.
    expect(body.outbound).toBeDefined();
    expect(body.outbound.length).toBe(15);
    expect(body.outboundCurrentPage).toBe(1);
    expect(body.outboundTotalPages).toBe(4);
    expect(body.outbound[0]).toHaveProperty('id');
    expect(body.outbound[0]).toHaveProperty('departure');
    expect(body.outbound[0]).toHaveProperty('arrival');
  });

  it('walks all pages of a search via /search/pages, covering the full 50-route set', async () => {
    const departureDate = '2027-01-24';

    const searchResponse = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const searchBody = JSON.parse(searchResponse.body);

    const allRouteIds = new Set<string>(searchBody.outbound.map((route: { id: string }) => route.id));

    for (let page = 2; page <= searchBody.outboundTotalPages; page++) {
      const pageResponse = await app.inject({
        method: 'GET',
        url: `/api/travel/v4/search/pages?id=${searchBody.id}&outboundPage=${page}`,
      });

      expect(pageResponse.statusCode).toBe(200);
      const pageBody = JSON.parse(pageResponse.body);
      expect(pageBody.outboundPage).toBe(page);
      expect(pageBody.outbound.length).toBeGreaterThan(0);
      expect(pageBody.outbound.length).toBeLessThanOrEqual(15);
      for (const route of pageBody.outbound) allRouteIds.add(route.id);
    }

    expect(allRouteIds.size).toBe(50);
  });

  it('rejects a page number beyond the available pages with a 400', async () => {
    const departureDate = '2027-01-24';

    const searchResponse = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const searchBody = JSON.parse(searchResponse.body);

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search/pages?id=${searchBody.id}&outboundPage=${searchBody.outboundTotalPages + 1}`,
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('PAGE_EXCEEDED');
  });

  it('returns 404 for an unknown or expired search id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/travel/v4/search/pages?id=not-a-real-search-id&outboundPage=1',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('SEARCH_NOT_FOUND');
  });

  it('rejects a search/pages call missing both outboundPage and inboundPage', async () => {
    const departureDate = '2027-01-24';

    const searchResponse = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const searchBody = JSON.parse(searchResponse.body);

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search/pages?id=${searchBody.id}`,
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('PAGE_REQUIRED');
  });

  it('exposes every seat class a flight offers, unlike v2 which only shows regular', async () => {
    const departureDate = '2027-01-24';

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
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

describe('V4 Auth - Token Refresh', () => {
  it('login returns both access_token and refresh_token', async () => {
    const username = 'token';
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/login',
      payload: { username, password: `tr@vel${username.slice(0, 5)}` },
    });

    expect(loginResponse.statusCode).toBe(200);
    const body = JSON.parse(loginResponse.body);
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('refresh_token');
    expect(body).toHaveProperty('token_type', 'Bearer');
    expect(body).toHaveProperty('expires_in');
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
  });

  it('refresh endpoint issues a new access_token using refresh_token', async () => {
    const username = 'fresh';
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/login',
      payload: { username, password: `tr@vel${username.slice(0, 5)}` },
    });

    const { refresh_token } = JSON.parse(loginResponse.body);

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/refresh',
      payload: { refresh_token },
    });

    expect(refreshResponse.statusCode).toBe(200);
    const body = JSON.parse(refreshResponse.body);
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('token_type', 'Bearer');
    expect(body).toHaveProperty('expires_in');
    expect(typeof body.access_token).toBe('string');
  });

  it('refresh endpoint rejects invalid refresh_token', async () => {
    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/refresh',
      payload: { refresh_token: 'invalid.token.here' },
    });

    expect(refreshResponse.statusCode).toBe(401);
    const body = JSON.parse(refreshResponse.body);
    expect(body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('refreshed access_token can be used to access protected endpoints', async () => {
    const username = 'renew';
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/login',
      payload: { username, password: `tr@vel${username.slice(0, 5)}` },
    });

    const { refresh_token } = JSON.parse(loginResponse.body);

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/refresh',
      payload: { refresh_token },
    });

    const { access_token } = JSON.parse(refreshResponse.body);

    const userResponse = await app.inject({
      method: 'GET',
      url: '/api/travel/v4/user',
      headers: { authorization: `Bearer ${access_token}` },
    });

    expect(userResponse.statusCode).toBe(200);
    const body = JSON.parse(userResponse.body);
    expect(body.username).toBe(username);
  });
});

describe('V4 Purchase (per-seat pricing)', () => {
  let token: string;

  beforeAll(async () => {
    const username = 'plane';
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/login',
      payload: { username, password: `tr@vel${username.slice(0, 5)}` },
    });
    token = JSON.parse(loginResponse.body).access_token;
  });

  async function searchOneWayRoute(): Promise<SearchedRoute> {
    const departureDate = '2027-01-24';
    const searchResponse = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const body = JSON.parse(searchResponse.body);
    const route = body.outbound[0];
    const currency = route.flights[0].pricing[0].currency;
    return { id: route.id, currency, flights: route.flights };
  }

  it('purchases a OneWay route by submitting one seat selection per flight', async () => {
    const route = await searchOneWayRoute();

    const seats = route.flights.map((flight) => {
      const currencyPricing = flight.pricing.find((p) => p.currency === route.currency) as FlightPricingRow;
      const seatClass = pickSeatClass(currencyPricing);
      return { flightId: flight.id, seatClass, currency: route.currency, price: currencyPricing[seatClass] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: route.id,
        currency: route.currency,
        seats,
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
      url: '/api/travel/v4/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: route.id,
        currency: route.currency,
        seats: [{ flightId: firstFlight.id, seatClass, currency: route.currency, price: currencyPricing[seatClass] }],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('MISSING_FLIGHT_SELECTION');
  });

  it('rejects a purchase where the submitted seat price does not match the stored flight price', async () => {
    const route = await searchOneWayRoute();

    const seats = route.flights.map((flight) => {
      const currencyPricing = flight.pricing.find((p) => p.currency === route.currency) as FlightPricingRow;
      const seatClass = pickSeatClass(currencyPricing);
      return {
        flightId: flight.id,
        seatClass,
        currency: route.currency,
        price: (currencyPricing[seatClass] as number) + 9999,
      };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: route.id,
        currency: route.currency,
        seats,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('PRICE_MISMATCH');
  });
});
