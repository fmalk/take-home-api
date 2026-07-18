import type { FastifyInstance } from 'fastify';
import type { Scenario } from '../../../types/index.js';
import { travelEndpoints } from '../standard/openapi.js';
import { registerRoutes } from './routes.js';

export const travelV1: Scenario = {
  namespace: 'travel/v1',

  async register(app: FastifyInstance): Promise<void> {
    await registerRoutes(app);
  },

  openapi() {
    return travelEndpoints;
  },
};
