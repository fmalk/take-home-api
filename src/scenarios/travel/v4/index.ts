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
      // Paginated follow-up to /search (see v4/routes.ts's searchPagesSchema): given a prior
      // search's id, returns just the requested page (<=15 routes) of outbound/inbound routes.
      '/api/travel/v4/search/pages': {
        get: {
          summary: 'Get a page of search results',
          description: 'Fetch a specific page (15 routes per page) of a prior search’s outbound and/or inbound routes',
          tags: [],
          parameters: [
            {
              name: 'id',
              in: 'query',
              description: 'Search ID returned by GET /search',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'outboundPage',
              in: 'query',
              description: 'Page number (1-based) of outbound routes to fetch',
              required: false,
              schema: { type: 'string' },
            },
            {
              name: 'inboundPage',
              in: 'query',
              description: 'Page number (1-based) of inbound routes to fetch',
              required: false,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Requested page(s) of routes' },
            '400': { description: 'Missing page params, invalid page number, page exceeded, or no inbound leg' },
            '404': { description: 'Search not found or expired' },
          },
        },
      },
    };
  },
};
