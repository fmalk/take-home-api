import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../../server.js';
import { registerScenarios } from '../../../scenarios/index.js';
import { initCache } from '../../../core/cache.js';

describe('V2 Flight Search - Route Cap Regression', () => {
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
      url: `/api/travel/v2/search?from=HKG&to=LAX&departureDate=${departureDate}`,
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

  it('caps NQZ->LAX search at 50 routes (high-airline-diversity regression)', async () => {
    // NQZ (Nur-Sultan) has 39 airlines; reaching LAX through multiple hub paths
    const departureDate = '2027-01-24';

    const response = await app.inject({
      method: 'GET',
      url: `/api/travel/v2/search?from=NQZ&to=LAX&departureDate=${departureDate}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.outbound).toBeDefined();
    expect(body.outbound.length).toBe(50);
  });
});
