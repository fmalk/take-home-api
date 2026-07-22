import { FastifyInstance } from 'fastify';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  baseSearchFlightsSchema,
  baseFlightDetailSchema,
  baseListAirportsSchema,
  baseListCitiesSchema,
  baseLoginSchema,
  baseUserSchema,
  flightResultCoreProperties,
  roundTripSearchFlightsQuerystring,
} from '../standard/openapi.js';
import { v2AirportSchema, v2FlightPricingItemSchema, v2RoutePricingItemSchema, v2LoginBodySchema } from './openapi.js';
import {
  searchFlights,
  getFlightDetail,
  listAirports,
  listCities,
  type SearchFlightsQuery,
  type FlightIdParams,
} from './controller.js';
import { createAuthController, type LoginBody } from '../../../core/auth.js';
import { servePostmanCollection } from '../../../utils/postman-handler.js';

// Travel's credential rule for the shared login fixture (see core/auth.ts): password is
// 'tr@vel' followed by the first 5 letters of the username.
const { loginBase, getUserBase } = createAuthController({
  namespace: 'travel',
  passwordFor: (username) => `tr@vel${username.slice(0, 5)}`,
});

// v2 hides the flat `price` simplification. Flights show the `regular`-tier pricing in every
// currency they offer; Routes show only the cheapest bookable `minimum` fare per currency,
// since a Route's legs may not all sell the same class.
const flightResultSchema = {
  type: 'object',
  properties: { ...flightResultCoreProperties, pricing: { type: 'array', items: v2FlightPricingItemSchema } },
};

const routeResultSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    flightTimeHours: { type: 'string', description: 'Flight time in HH:MM format' },
    flightDistanceKms: { type: 'integer' },
    departure: flightResultSchema.properties.departure,
    arrival: flightResultSchema.properties.arrival,
    flights: {
      type: 'array',
      items: flightResultSchema,
    },
    available: { type: 'number' },
    pricing: { type: 'array', items: v2RoutePricingItemSchema },
  },
};

// v2 additionally accepts `mode`/`returnDate` for RoundTrip searches, and its response carries
// the RoundTrip's `inbound` leg alongside `outbound` (v1 only ever has `outbound`).
const searchFlightsSchema = {
  ...baseSearchFlightsSchema,
  querystring: roundTripSearchFlightsQuerystring,
  response: {
    200: {
      ...baseSearchFlightsSchema.response[200],
      properties: {
        ...baseSearchFlightsSchema.response[200].properties,
        returnDate: { type: 'string' },
        outbound: { type: 'array', items: routeResultSchema },
        inbound: { type: 'array', items: routeResultSchema },
      },
    },
  },
};

const flightDetailSchema = {
  ...baseFlightDetailSchema,
  response: {
    200: flightResultSchema,
  },
};

// v2 airports keep the full shape, so the response schema swaps in the untrimmed item schema.
const listAirportsSchema = {
  ...baseListAirportsSchema,
  response: {
    200: {
      ...baseListAirportsSchema.response[200],
      properties: {
        airports: { type: 'array', items: v2AirportSchema },
      },
    },
  },
};
const listCitiesSchema = { ...baseListCitiesSchema };
// v2 doesn't (yet) expose `shortLived` — see v2LoginBodySchema.
const loginSchema = { ...baseLoginSchema, body: v2LoginBodySchema };
const userSchema = { ...baseUserSchema };

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Scoped so @fastify/swagger-ui's decorators (it uses fastify-plugin internally) stay isolated
  // to this version — registering it twice at root would collide across scenario versions.
  await app.register(async (scoped) => {
    await scoped.register(fastifySwaggerUi, {
      routePrefix: '/api/travel/v2/swagger',
      uiConfig: {
        deepLinking: true,
      },
    });

    scoped.get(
      '/api/travel/v2/postman',
      {
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      async (request, reply) => {
        await servePostmanCollection('travel/v2', request, reply);
      },
    );

    scoped.get<{ Querystring: SearchFlightsQuery }>(
      '/api/travel/v2/search',
      {
        schema: searchFlightsSchema,
        onSend: async (_request, reply) => {
          // Flight IDs in search results are only resolvable for ~4:30 min (instance store TTL = 5 min).
          reply.header('Cache-Control', 'public, max-age=270');
        },
      },
      searchFlights,
    );

    scoped.get<{ Params: FlightIdParams }>(
      '/api/travel/v2/flights/:id',
      {
        schema: flightDetailSchema,
        onSend: async (_request, reply) => {
          // Flight IDs in search results are only resolvable for ~4:30 min (instance store TTL = 5 min).
          reply.header('Cache-Control', 'public, max-age=270');
        },
      },
      getFlightDetail,
    );

    scoped.get(
      '/api/travel/v2/airports',
      {
        schema: listAirportsSchema,
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      listAirports,
    );

    scoped.get(
      '/api/travel/v2/cities',
      {
        schema: listCitiesSchema,
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      listCities,
    );

    scoped.post<{ Body: LoginBody }>('/api/travel/v2/login', { schema: loginSchema }, loginBase);

    scoped.get('/api/travel/v2/user', { schema: userSchema }, getUserBase);
  });
}
