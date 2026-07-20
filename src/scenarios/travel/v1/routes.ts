import { FastifyInstance } from 'fastify';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  baseSearchFlightsSchema,
  baseFlightDetailSchema,
  baseListAirportsSchema,
  baseListCitiesSchema,
} from '../standard/openapi.js';
import { v1AirportSchema } from './openapi.js';
import {
  searchFlights,
  getFlightDetail,
  listAirports,
  listCities,
  type SearchFlightsQuery,
  type FlightIdParams,
} from './controller.js';
import { servePostmanCollection } from '../../../utils/postman-handler.js';

// v1 schemas are the shared base as-is today; spread/override here if this
// version ever needs route-specific validation or response tweaks.
const searchFlightsSchema = { ...baseSearchFlightsSchema };
const flightDetailSchema = { ...baseFlightDetailSchema };
// v1 airports drop icao/utcOffset, so the response schema swaps in the trimmed item schema.
const listAirportsSchema = {
  ...baseListAirportsSchema,
  response: {
    200: {
      ...baseListAirportsSchema.response[200],
      properties: {
        airports: { type: 'array', items: v1AirportSchema },
      },
    },
  },
};
const listCitiesSchema = { ...baseListCitiesSchema };

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Register Swagger UI for this scenario/version
  await app.register(fastifySwaggerUi, {
    routePrefix: '/api/travel/v1/swagger',
    uiConfig: {
      deepLinking: true,
    },
  });

  app.get(
    '/api/travel/v1/postman',
    async (request, reply) => {
      await servePostmanCollection('travel/v1', request, reply);
    },
  );

  app.get<{ Querystring: SearchFlightsQuery }>(
    '/api/travel/v1/search',
    {
      schema: searchFlightsSchema,
      onSend: (_request, reply) => {
        // Flight IDs in search results are only resolvable for ~4:30 min (instance store TTL = 5 min).
        // Signal this to clients/proxies so they know to refresh if fetching flight details later.
        reply.header('Cache-Control', 'public, max-age=270');
      },
    },
    searchFlights,
  );

  app.get<{ Params: FlightIdParams }>(
    '/api/travel/v1/flights/:id',
    {
      schema: flightDetailSchema,
    },
    getFlightDetail,
  );

  app.get(
    '/api/travel/v1/airports',
    {
      schema: listAirportsSchema,
      onSend: async (_request, reply) => {
        reply.header('Cache-Control', 'public, max-age=86400');
      },
    },
    listAirports,
  );

  app.get(
    '/api/travel/v1/cities',
    {
      schema: listCitiesSchema,
      onSend: async (_request, reply) => {
        reply.header('Cache-Control', 'public, max-age=86400');
      },
    },
    listCities,
  );
}
