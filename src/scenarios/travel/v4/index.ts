import type { FastifyInstance } from 'fastify';
import type { Scenario } from '../../../types.js';
import { buildTravelEndpoints, buildAuthEndpoints, buildPurchaseEndpoints } from '../standard/openapi.js';
import { v4LoginBodySchema, v4PurchaseBodySchema } from './openapi.js';
import { registerRoutes } from './routes.js';

export const travelV4: Scenario = {
  namespace: 'travel/v4',

  async register(app: FastifyInstance): Promise<void> {
    await registerRoutes(app);
  },

  openapi() {
    // v4 exposes every seat class (see v4/controller.ts's toV4Flight), same as v3.
    return {
      ...buildTravelEndpoints('v4'),
      ...buildAuthEndpoints('v4', v4LoginBodySchema),
      ...buildPurchaseEndpoints('v4', v4PurchaseBodySchema),
    };
  },
};
