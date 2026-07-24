import type { FastifyInstance } from 'fastify';
import type { Scenario } from '../../../types.js';
import { buildTravelEndpoints, buildAuthEndpoints, buildPurchaseEndpoints } from '../standard/openapi.js';
import { v3LoginBodySchema } from './openapi.js';
import { registerRoutes } from './routes.js';

export const travelV3: Scenario = {
  namespace: 'travel/v3',

  async register(app: FastifyInstance): Promise<void> {
    await registerRoutes(app);
  },

  openapi() {
    // v3 is the first version to expose every seat class (see v3/controller.ts's toV3Flight).
    return {
      ...buildTravelEndpoints('v3'),
      ...buildAuthEndpoints('v3', v3LoginBodySchema),
      ...buildPurchaseEndpoints('v3'),
    };
  },
};
