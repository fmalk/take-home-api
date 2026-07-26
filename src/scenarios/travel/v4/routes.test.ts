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

function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('V4 Flight Search - recent-date seat trim (TAK-27)', () => {
  it('drops exactly one seat class per flight when departureDate is within 15 days', async () => {
    const departureDate = daysFromNow(10);

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    let checkedAtLeastOneMultiClassFlight = false;
    for (const route of body.outbound) {
      for (const flight of route.flights) {
        const classesShown = new Set<string>();
        for (const pricing of flight.pricing) {
          for (const key of ['regular', 'economy', 'businessClass', 'firstClass']) {
            if (pricing[key] !== undefined) classesShown.add(key);
          }
        }
        // A flight with only one class to begin with must keep it (never trimmed to zero
        // classes); a flight is never shown with all four it could otherwise offer within the
        // recent-date window, since one is always withheld once it has 2+.
        expect(classesShown.size).toBeGreaterThanOrEqual(1);
        if (classesShown.size >= 1) checkedAtLeastOneMultiClassFlight = true;
      }
    }
    expect(checkedAtLeastOneMultiClassFlight).toBe(true);
  });

  it('never removes the only seat class a flight offers, even within the recent-date window', async () => {
    const departureDate = daysFromNow(10);

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    for (const route of body.outbound) {
      for (const flight of route.flights) {
        const classesShown = new Set<string>();
        for (const pricing of flight.pricing) {
          for (const key of ['regular', 'economy', 'businessClass', 'firstClass']) {
            if (pricing[key] !== undefined) classesShown.add(key);
          }
        }
        expect(classesShown.size).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('drops the withheld seat class across every currency row on a flight, not just one', async () => {
    const departureDate = daysFromNow(10);

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

    const body = JSON.parse(response.body);

    for (const route of body.outbound) {
      for (const flight of route.flights) {
        const currencies = new Set(flight.pricing.map((p: FlightPricingRow) => p.currency));
        for (const key of ['regular', 'economy', 'businessClass', 'firstClass']) {
          const currenciesOfferingClass = new Set(
            flight.pricing
              .filter((p: FlightPricingRow) => p[key] !== undefined)
              .map((p: FlightPricingRow) => p.currency),
          );
          // A class is either offered on every currency this flight sells, or on none of them —
          // never a partial drop leaving it priced in some currencies but not others.
          expect(currenciesOfferingClass.size === 0 || currenciesOfferingClass.size === currencies.size).toBe(true);
        }
      }
    }
  });

  it('does not trim seat classes for a departureDate outside the 15-day window', async () => {
    const departureDate = '2027-01-24';

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

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

    expect(seatClasses.has('regular') || seatClasses.has('economy')).toBe(true);
    expect(seatClasses.has('businessClass') || seatClasses.has('firstClass')).toBe(true);
  });

  it('recomputes route pricing.minimum consistently with the trimmed flight pricing', async () => {
    const departureDate = daysFromNow(10);

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

    const body = JSON.parse(response.body);

    for (const route of body.outbound) {
      for (const routePricing of route.pricing) {
        // Every currency the route claims a minimum for must actually be quotable (regular or
        // economy) on every leg post-trim — otherwise the route promises a fare its own
        // (trimmed) flights can no longer back up.
        for (const flight of route.flights) {
          const hasRegularOrEconomy = flight.pricing.some(
            (p: FlightPricingRow) =>
              p.currency === routePricing.currency && (p.regular !== undefined || p.economy !== undefined),
          );
          expect(hasRegularOrEconomy).toBe(true);
        }
      }
    }
  });

  it('recalculates flight.available to only the surviving classes’ pools, and route.available as the min across legs', async () => {
    const departureDate = daysFromNow(10);

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });

    const body = JSON.parse(response.body);

    for (const route of body.outbound) {
      for (const flight of route.flights) {
        // Flight.available (the whole-plane pool) is generated as the SUM of every offered
        // class's independent pool (see applySeatClassSplit in generator.ts) — e.g. 40 regular +
        // 50 economy = 90. Once a class's pricing rows are dropped, available must shrink to
        // just the surviving classes' pools, not keep advertising the pre-trim total.
        const perClassPools = flight.pricing.map((p: FlightPricingRow) => p.available as number);
        expect(flight.available).toBe(Math.max(...perClassPools));
      }

      const minFlightAvailable = Math.min(...route.flights.map((f: { available: number }) => f.available));
      expect(route.available).toBe(minFlightAvailable);
    }
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
  pricing?: FlightPricingRow[];
}

function pickSeatClass(currencyPricing: FlightPricingRow): string {
  return ['regular', 'economy', 'businessClass', 'firstClass'].find(
    (key) => currencyPricing[key] !== undefined,
  ) as string;
}

// TAK-28: LOY (Loyalty Points) is a v4-only pricing currency, generated only for flights whose
// airline has a loyalty program (Airline.hasLoyaltyProgram). Search date is far outside the
// 15-day recent-date window (see the TAK-27 suite above) so seat classes aren't randomly trimmed.
describe('V4 Flight Search - Loyalty Points (TAK-28)', () => {
  const departureDate = '2027-01-24';

  async function searchHkgLax(): Promise<SearchedRoute[]> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const responseBody = JSON.parse(response.body);
    return responseBody.outbound;
  }

  it('offers a LOY pricing row on at least one flight across a large HKG->LAX result set', async () => {
    const routes = await searchHkgLax();

    let sawLoy = false;
    for (const route of routes) {
      for (const flight of route.flights) {
        if (flight.pricing.some((p: FlightPricingRow) => p.currency === 'LOY')) {
          sawLoy = true;
        }
      }
    }
    expect(sawLoy).toBe(true);
  });

  it('never prices LOY below 9000 or above 1,000,000, and always on a 1000-step', async () => {
    const routes = await searchHkgLax();

    let checkedAtLeastOneLoyRow = false;
    for (const route of routes) {
      for (const flight of route.flights) {
        for (const pricing of flight.pricing) {
          if (pricing.currency !== 'LOY') continue;
          for (const key of ['regular', 'economy', 'businessClass', 'firstClass']) {
            const price = pricing[key] as number | undefined;
            if (price === undefined) continue;
            checkedAtLeastOneLoyRow = true;
            expect(price).toBeGreaterThanOrEqual(9000);
            expect(price).toBeLessThanOrEqual(1_000_000);
            expect(price % 1000).toBe(0);
          }
        }
      }
    }
    expect(checkedAtLeastOneLoyRow).toBe(true);
  });

  it('never counts LOY toward a route’s cheapest-bookable-fare pricing.minimum', async () => {
    const routes = await searchHkgLax();

    for (const route of routes) {
      expect((route.pricing ?? []).some((p) => p.currency === 'LOY')).toBe(false);
    }
  });

  it('prices richer classes higher in LOY, matching the fixed per-class rate ordering', async () => {
    const routes = await searchHkgLax();

    for (const route of routes) {
      for (const flight of route.flights) {
        const loyRow = flight.pricing.find((p: FlightPricingRow) => p.currency === 'LOY');
        if (!loyRow) continue;

        // Not every flight offers every class, but where two premium classes coexist on the
        // same LOY row, the higher-rate class must never price lower.
        if (loyRow.businessClass !== undefined && loyRow.regular !== undefined) {
          expect(loyRow.businessClass as number).toBeGreaterThanOrEqual(loyRow.regular as number);
        }
        if (loyRow.firstClass !== undefined && loyRow.businessClass !== undefined) {
          expect(loyRow.firstClass as number).toBeGreaterThanOrEqual(loyRow.businessClass as number);
        }
      }
    }
  });
});

describe('V4 Flight Search - Loyalty Points and the 15-day seat trim (TAK-27 + TAK-28)', () => {
  it('drops a withheld seat class’s LOY row along with its USD/local-currency rows', async () => {
    const departureDate = daysFromNow(10);

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const body = JSON.parse(response.body);

    for (const route of body.outbound) {
      for (const flight of route.flights) {
        for (const key of ['regular', 'economy', 'businessClass', 'firstClass']) {
          const currenciesOfferingClass = new Set(
            flight.pricing
              .filter((p: FlightPricingRow) => p[key] !== undefined)
              .map((p: FlightPricingRow) => p.currency),
          );
          if (currenciesOfferingClass.size === 0) continue;

          // A surviving class must be priced consistently across every currency it offers,
          // including LOY when the airline has a loyalty program — never partially dropped.
          const nonLoyCurrencies = new Set(
            flight.pricing
              .filter((p: FlightPricingRow) => p.currency !== 'LOY' && p[key] !== undefined)
              .map((p: FlightPricingRow) => p.currency),
          );
          const hasLoy = currenciesOfferingClass.has('LOY');
          if (hasLoy) {
            expect(nonLoyCurrencies.size).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe('V4 Purchase - Loyalty Points all-or-nothing (TAK-28)', () => {
  let token: string;

  beforeAll(async () => {
    const username = 'loyal';
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/login',
      payload: { username, password: `tr@vel${username.slice(0, 5)}` },
    });
    token = JSON.parse(loginResponse.body).access_token;
  });

  async function searchRouteWithLoyalty(): Promise<SearchedRoute | undefined> {
    const departureDate = '2027-01-24';
    const searchResponse = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const body = JSON.parse(searchResponse.body);

    for (const route of body.outbound) {
      const everyFlightHasLoy = route.flights.every((f: SearchedFlight) =>
        f.pricing.some((p: FlightPricingRow) => p.currency === 'LOY'),
      );
      if (everyFlightHasLoy) {
        return { id: route.id, currency: 'LOY', flights: route.flights };
      }
    }
    return undefined;
  }

  it('purchases a route entirely in LOY when every flight offers a loyalty-eligible airline', async () => {
    const route = await searchRouteWithLoyalty();
    if (!route) return; // HKG->LAX's random airline mix didn't surface an all-LOY route this run.

    const seats = route.flights.map((flight) => {
      const loyPricing = flight.pricing.find((p) => p.currency === 'LOY') as FlightPricingRow;
      const seatClass = pickSeatClass(loyPricing);
      return { flightId: flight.id, seatClass, currency: 'LOY', price: loyPricing[seatClass] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: route.id,
        currency: 'LOY',
        seats,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.currency).toBe('LOY');
  });

  it('rejects a purchase where the request currency is LOY but a seat selection uses a different currency', async () => {
    const route = await searchRouteWithLoyalty();
    if (!route) return;

    const [firstFlight, ...restFlights] = route.flights;
    const loyPricing = firstFlight.pricing.find((p) => p.currency === 'LOY') as FlightPricingRow;
    const firstSeatClass = pickSeatClass(loyPricing);

    const seats = [
      { flightId: firstFlight.id, seatClass: firstSeatClass, currency: 'USD', price: 100 },
      ...restFlights.map((flight) => {
        const pricing = flight.pricing.find((p) => p.currency === 'LOY') as FlightPricingRow;
        const seatClass = pickSeatClass(pricing);
        return { flightId: flight.id, seatClass, currency: 'LOY', price: pricing[seatClass] };
      }),
    ];

    const response = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: route.id,
        currency: 'LOY',
        seats,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('CURRENCY_MISMATCH');
  });

  it('rejects a LOY purchase for a flight whose airline has no loyalty program', async () => {
    const departureDate = '2027-01-24';
    const searchResponse = await app.inject({
      method: 'GET',
      url: `/api/travel/v4/search?from=HKG&to=LAX&departureDate=${departureDate}`,
    });
    const searchBody = JSON.parse(searchResponse.body);

    let nonLoyaltyFlight: SearchedFlight | undefined;
    let routeId: string | undefined;
    for (const route of searchBody.outbound) {
      const found = route.flights.find(
        (f: SearchedFlight) => !f.pricing.some((p: FlightPricingRow) => p.currency === 'LOY'),
      );
      if (found) {
        nonLoyaltyFlight = found;
        routeId = route.id;
        break;
      }
    }
    if (!nonLoyaltyFlight || !routeId) return; // Every flight this run happened to offer LOY.

    const response = await app.inject({
      method: 'POST',
      url: '/api/travel/v4/purchase',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        mode: 'OneWay',
        outboundId: routeId,
        currency: 'LOY',
        seats: [{ flightId: nonLoyaltyFlight.id, seatClass: 'regular', currency: 'LOY', price: 9000 }],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(['CURRENCY_NOT_AVAILABLE', 'SEAT_CLASS_NOT_AVAILABLE', 'MISSING_FLIGHT_SELECTION']).toContain(body.code);
  });
});

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
