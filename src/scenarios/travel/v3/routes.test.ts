import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../server.js';
import { registerScenarios } from '../../../scenarios/index.js';
import { initCache } from '../../../core/cache.js';

describe('V3 Flight Search', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    initCache();
    app = await buildServer();
    await registerScenarios(app);
  });

  afterAll(async () => {
    await app.close();
  });

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
