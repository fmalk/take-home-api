import type { FastifyInstance } from 'fastify';
import type { Scenario } from '../../../types.js';
import { buildTravelEndpoints, buildAuthEndpoints } from '../standard/openapi.js';
import { v2LoginBodySchema } from './openapi.js';
import { registerRoutes } from './routes.js';

export const travelV2: Scenario = {
  namespace: 'travel/v2',

  async register(app: FastifyInstance): Promise<void> {
    await registerRoutes(app);
  },

  openapi() {
    // v2 is the first version with login/user (see routes.ts); v1 stays search/detail/airports/cities only.
    return { ...buildTravelEndpoints('v2'), ...buildAuthEndpoints('v2', v2LoginBodySchema) };
  },
};
