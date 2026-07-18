import { FastifyInstance } from 'fastify';
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
  app.get<{ Querystring: SearchFlightsQuery }>(
    '/api/travel/v1/search',
    {
      schema: searchFlightsSchema,
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
      onSend: (_request, reply) => {
        reply.header('Cache-Control', 'public, max-age=86400');
      },
    },
    listAirports,
  );

  app.get(
    '/api/travel/v1/cities',
    {
      schema: listCitiesSchema,
      onSend: (_request, reply) => {
        reply.header('Cache-Control', 'public, max-age=86400');
      },
    },
    listCities,
  );
}
