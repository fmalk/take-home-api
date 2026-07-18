import { FastifyInstance } from 'fastify';
import {
  baseSearchFlightsSchema,
  baseFlightDetailSchema,
  baseListAirportsSchema,
  baseListCitiesSchema,
} from '../types/openapi.js';
import { searchFlights, getFlightDetail, listAirports, listCities } from './controller.js';

// v1 schemas are the shared base as-is today; spread/override here if this
// version ever needs route-specific validation or response tweaks.
const searchFlightsSchema = { ...baseSearchFlightsSchema };
const flightDetailSchema = { ...baseFlightDetailSchema };
const listAirportsSchema = { ...baseListAirportsSchema };
const listCitiesSchema = { ...baseListCitiesSchema };

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { from: string; to: string; date: string } }>(
    '/api/travel/v1/search',
    {
      schema: searchFlightsSchema,
    },
    searchFlights,
  );

  app.get<{ Params: { id: string } }>(
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
    },
    listAirports,
  );

  app.get(
    '/api/travel/v1/cities',
    {
      schema: listCitiesSchema,
    },
    listCities,
  );
}
