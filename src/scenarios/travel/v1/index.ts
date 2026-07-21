import type { FastifyInstance } from 'fastify';
import type { Scenario } from '../../../types.js';
import { buildTravelEndpoints } from '../standard/openapi.js';
import { registerRoutes } from './routes.js';

export const travelV1: Scenario = {
  namespace: 'travel/v1',

  async register(app: FastifyInstance): Promise<void> {
    await registerRoutes(app);
  },

  openapi() {
    return buildTravelEndpoints('v1');
  },
};
