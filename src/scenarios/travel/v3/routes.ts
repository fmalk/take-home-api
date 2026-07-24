import { FastifyInstance } from 'fastify';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  baseSearchFlightsSchema,
  baseFlightDetailSchema,
  baseListAirportsSchema,
  baseListCitiesSchema,
  baseLoginSchema,
  baseUserSchema,
  basePurchaseSchema,
  flightResultCoreProperties,
  roundTripSearchFlightsQuerystring,
} from '../standard/openapi.js';
import { v3AirportSchema, v3FlightPricingItemSchema, v3RoutePricingItemSchema, v3LoginBodySchema } from './openapi.js';
import {
  searchFlights,
  getFlightDetail,
  listAirports,
  listCities,
  createPurchase,
  type SearchFlightsQuery,
  type FlightIdParams,
  type PurchaseBody,
} from './controller.js';
import { createAuthController, type LoginBody } from '../../../core/auth.js';
import { servePostmanCollection } from '../../../utils/postman-handler.js';

// Travel's credential rule for the shared login fixture (see core/auth.ts): password is
// 'tr@vel' followed by the first 5 letters of the username.
const { loginBase, getUserBase } = createAuthController({
  namespace: 'travel',
  passwordFor: (username) => `tr@vel${username.slice(0, 5)}`,
});

const purchase = createPurchase(getUserBase);

// v3 is the first version to expose every seat class an airline offers (regular/economy/
// businessClass/firstClass) — see v3/controller.ts's toV3Flight, which unlike v2 does not
// filter the `pricing` array down to `regular`.
const flightResultSchema = {
  type: 'object',
  properties: { ...flightResultCoreProperties, pricing: { type: 'array', items: v3FlightPricingItemSchema } },
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
    pricing: { type: 'array', items: v3RoutePricingItemSchema },
  },
};

// v3 accepts `mode`/`returnDate` for RoundTrip searches, same as v2, and its response carries
// the RoundTrip's `inbound` leg alongside `outbound`.
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

// v3 airports keep the full shape, so the response schema swaps in the untrimmed item schema.
const listAirportsSchema = {
  ...baseListAirportsSchema,
  response: {
    200: {
      ...baseListAirportsSchema.response[200],
      properties: {
        airports: { type: 'array', items: v3AirportSchema },
      },
    },
  },
};
const listCitiesSchema = { ...baseListCitiesSchema };
// v3 is the first version to expose `shortLived` (see v3LoginBodySchema).
const loginSchema = { ...baseLoginSchema, body: v3LoginBodySchema };
const userSchema = { ...baseUserSchema };

// v3's purchase response carries the same per-currency `pricing` breakdown as its search/detail
// routes, so it swaps in this file's routeResultSchema for the base's flat-`price` version; the
// `user` shape is already the full AuthUser surface (basePurchaseSchema's userResponseSchema),
// so it needs no override here.
const purchaseSchema = {
  ...basePurchaseSchema,
  response: {
    200: {
      ...basePurchaseSchema.response[200],
      properties: {
        ...basePurchaseSchema.response[200].properties,
        outbound: routeResultSchema,
        inbound: routeResultSchema,
      },
    },
  },
};

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Scoped so @fastify/swagger-ui's decorators (it uses fastify-plugin internally) stay isolated
  // to this version — registering it twice at root would collide across scenario versions.
  await app.register(async (scoped) => {
    await scoped.register(fastifySwaggerUi, {
      routePrefix: '/api/travel/v3/swagger',
      uiConfig: {
        deepLinking: true,
      },
    });

    scoped.get(
      '/api/travel/v3/postman',
      {
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      async (request, reply) => {
        await servePostmanCollection('travel/v3', request, reply);
      },
    );

    scoped.get<{ Querystring: SearchFlightsQuery }>(
      '/api/travel/v3/search',
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
      '/api/travel/v3/flights/:id',
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
      '/api/travel/v3/airports',
      {
        schema: listAirportsSchema,
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      listAirports,
    );

    scoped.get(
      '/api/travel/v3/cities',
      {
        schema: listCitiesSchema,
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      listCities,
    );

    scoped.post<{ Body: LoginBody }>('/api/travel/v3/login', { schema: loginSchema }, loginBase);

    scoped.get('/api/travel/v3/user', { schema: userSchema }, getUserBase);

    scoped.post<{ Body: PurchaseBody }>('/api/travel/v3/purchase', { schema: purchaseSchema }, purchase);
  });
}
