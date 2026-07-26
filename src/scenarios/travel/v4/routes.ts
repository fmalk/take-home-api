import { FastifyInstance } from 'fastify';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  baseSearchFlightsSchema,
  baseFlightDetailSchema,
  baseListAirportsSchema,
  baseListCitiesSchema,
  baseLoginSchema,
  baseUserSchema,
  baseRefreshSchema,
  basePurchaseSchema,
  flightResultCoreProperties,
  roundTripSearchFlightsQuerystring,
} from '../standard/openapi.js';
import {
  v4AirportSchema,
  v4FlightPricingItemSchema,
  v4RoutePricingItemSchema,
  v4LoginBodySchema,
  v4PurchaseBodySchema,
  v4SearchPaginationProperties,
  v4SearchPagesQuerystring,
} from './openapi.js';
import {
  searchFlights,
  getFlightDetail,
  listAirports,
  listCities,
  createPurchase,
  getSearchPage,
  type SearchFlightsQuery,
  type FlightIdParams,
  type PurchaseBody,
} from './controller.js';
import type { SearchPagesQuery } from './types.js';
import { createAuthController, type LoginBody, type RefreshBody } from '../../../core/auth.js';
import { servePostmanCollection } from '../../../utils/postman-handler.js';

// Travel's credential rule for the shared login fixture (see core/auth.ts): password is
// 'tr@vel' followed by the first 5 letters of the username.
const { loginBase, refreshBase, getUserBase } = createAuthController({
  namespace: 'travel',
  passwordFor: (username) => `tr@vel${username.slice(0, 5)}`,
});

const purchase = createPurchase(getUserBase);

// v4 exposes every seat class an airline offers (regular/economy/businessClass/firstClass) —
// see v4/controller.ts's toV4Flight, which does not filter the `pricing` array down to `regular`.
const flightResultSchema = {
  type: 'object',
  properties: { ...flightResultCoreProperties, pricing: { type: 'array', items: v4FlightPricingItemSchema } },
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
    pricing: { type: 'array', items: v4RoutePricingItemSchema },
  },
};

// v4 accepts `mode`/`returnDate` for RoundTrip searches, same as v3, and its response carries
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
        ...v4SearchPaginationProperties,
      },
    },
  },
};

// Paginated follow-up to /search: given a prior search's id, returns just the requested page
// (<=15 routes, see v4/types.ts's SEARCH_PAGE_SIZE) of its outbound and/or inbound routes.
const searchPagesSchema = {
  querystring: v4SearchPagesQuerystring,
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        outboundPage: { type: 'number' },
        outbound: { type: 'array', items: routeResultSchema },
        inboundPage: { type: 'number' },
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

// v4 airports keep the full shape, so the response schema swaps in the untrimmed item schema.
const listAirportsSchema = {
  ...baseListAirportsSchema,
  response: {
    200: {
      ...baseListAirportsSchema.response[200],
      properties: {
        airports: { type: 'array', items: v4AirportSchema },
      },
    },
  },
};
const listCitiesSchema = { ...baseListCitiesSchema };
// v4 exposes `shortLived` (see v4LoginBodySchema).
const loginSchema = { ...baseLoginSchema, body: v4LoginBodySchema };
const userSchema = { ...baseUserSchema };

// v4's purchase response carries the same per-currency `pricing` breakdown as its search/detail
// routes, so it swaps in this file's routeResultSchema for the base's flat-`price` version; the
// `user` shape is already the full AuthUser surface (basePurchaseSchema's userResponseSchema),
// so it needs no override here.
const purchaseSchema = {
  ...basePurchaseSchema,
  body: v4PurchaseBodySchema,
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
      routePrefix: '/api/travel/v4/swagger',
      uiConfig: {
        deepLinking: true,
      },
    });

    scoped.get(
      '/api/travel/v4/postman',
      {
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      async (request, reply) => {
        await servePostmanCollection('travel/v4', request, reply);
      },
    );

    scoped.get<{ Querystring: SearchFlightsQuery }>(
      '/api/travel/v4/search',
      {
        schema: searchFlightsSchema,
        onSend: async (_request, reply) => {
          // Flight IDs in search results are only resolvable for ~4:30 min (instance store TTL = 5 min).
          reply.header('Cache-Control', 'public, max-age=270');
        },
      },
      searchFlights,
    );

    scoped.get<{ Querystring: SearchPagesQuery }>(
      '/api/travel/v4/search/pages',
      {
        schema: searchPagesSchema,
        onSend: async (_request, reply) => {
          // Same TTL as the underlying search's stored routes (instance store TTL = 5 min).
          reply.header('Cache-Control', 'public, max-age=270');
        },
      },
      getSearchPage,
    );

    scoped.get<{ Params: FlightIdParams }>(
      '/api/travel/v4/flights/:id',
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
      '/api/travel/v4/airports',
      {
        schema: listAirportsSchema,
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      listAirports,
    );

    scoped.get(
      '/api/travel/v4/cities',
      {
        schema: listCitiesSchema,
        onSend: async (_request, reply) => {
          reply.header('Cache-Control', 'public, max-age=86400');
        },
      },
      listCities,
    );

    scoped.post<{ Body: LoginBody }>('/api/travel/v4/login', { schema: loginSchema }, loginBase);

    scoped.post<{ Body: RefreshBody }>('/api/travel/v4/refresh', { schema: baseRefreshSchema }, refreshBase);

    scoped.get('/api/travel/v4/user', { schema: userSchema }, getUserBase);

    scoped.post<{ Body: PurchaseBody }>('/api/travel/v4/purchase', { schema: purchaseSchema }, purchase);
  });
}
