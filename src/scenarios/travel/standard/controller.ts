import type { FastifyRequest } from 'fastify';
import { faker } from '@faker-js/faker';
import { ApiError } from '../../../types.js';
import { cacheKey, getCached, setCached } from '../../../core/cache.js';
import { findDirectFlights, findConnectingRoutes, applyTimeFlow, groupRoutes, generateId } from './generator.js';
import { TravelStore } from './store.js';
import { storeRoutes, getStoredFlight, getStoredRoute } from './instance-store.js';
import { logFlow } from '../../../core/logger.js';
import type { Flight, Route, Airport, City, SearchResults } from './types.js';
import { formatFlight, formatRoute, type FormattedFlight, type FormattedRoute } from './formatters.js';

const CACHE_TTL = 3600;
const LARGE_CACHE_TTL = 3600 * 24;
// Shared across every version: the underlying search/detail/airport/city data isn't
// version-specific, only its presentation is (see v1/controller.ts, v2/controller.ts). Caching
// it once here means two versions hitting the same query reuse the same generated instances.
const NAMESPACE = 'travel:base';

const store = new TravelStore();

export type SearchMode = 'OneWay' | 'RoundTrip';

export interface SearchFlightsQuery {
  from: string;
  to: string;
  departureDate: string;
  // v1's querystring schema rejects these outright (additionalProperties: false), so only
  // v2+ requests ever carry them; searchFlightsBase treats a missing mode as 'OneWay'.
  mode?: SearchMode;
  returnDate?: string;
}

export interface FlightIdParams {
  id: string;
}

export type SearchFlightsRequest = FastifyRequest<{ Querystring: SearchFlightsQuery }>;
export type FlightDetailRequest = FastifyRequest<{ Params: FlightIdParams }>;

export interface SearchFlightsBaseResult extends SearchResults<FormattedRoute> {
  from: string;
  to: string;
  departureDate: string;
  returnDate?: string;
}

// Runs the direct/connecting/time-flow/grouping pipeline for a single from→to/date leg,
// reusing the per-leg cache. Shared by the outbound search and, in RoundTrip mode, the
// inbound (return) search — each leg is cached independently since they're different queries.
async function findRoutesForLeg(
  from: string,
  to: string,
  date: string,
  reqId: string,
  leg: 'outbound' | 'inbound',
): Promise<Route[]> {
  logFlow({
    reqId,
    flow: 'flight-search',
    step: 'query',
    data: { leg, from, to, date },
  });

  const cacheKeyVal = cacheKey(NAMESPACE, 'flights', from, to, date);
  let routesData = getCached<Route[]>(cacheKeyVal);

  if (!routesData) {
    const direct = await findDirectFlights(from, to, date, 5);
    const sequences: Flight[][] =
      direct.length > 0 ? direct.map((f) => [f]) : await findConnectingRoutes(from, to, date);
    const timed = await applyTimeFlow(sequences, date);
    const generated = groupRoutes(timed);
    setCached(cacheKeyVal, generated, CACHE_TTL);

    logFlow({
      reqId,
      flow: 'flight-search',
      step: 'generated',
      data: { leg, count: generated.length, direct: direct.length > 0 },
    });
    routesData = generated;
  } else {
    logFlow({
      reqId,
      flow: 'flight-search',
      step: 'cached',
      data: { leg },
    });
  }

  return routesData;
}

export async function searchFlightsBase(request: SearchFlightsRequest): Promise<SearchFlightsBaseResult> {
  const { from, to, departureDate, returnDate } = request.query;
  const modeParam = request.query.mode?.toLowerCase();

  if (modeParam && modeParam !== 'oneway' && modeParam !== 'roundtrip') {
    throw new ApiError(400, 'INVALID_MODE', "mode must be 'OneWay' or 'RoundTrip'");
  }

  const mode: SearchMode = modeParam === 'roundtrip' ? 'RoundTrip' : 'OneWay';

  if (mode === 'RoundTrip' && !returnDate) {
    throw new ApiError(400, 'RETURN_DATE_REQUIRED', 'returnDate is required when mode is RoundTrip');
  }

  if (mode === 'RoundTrip' && returnDate && returnDate <= departureDate) {
    throw new ApiError(400, 'INVALID_RETURN_DATE', 'returnDate must be after departureDate');
  }

  const outboundRoutes = await findRoutesForLeg(from, to, departureDate, request.id, 'outbound');
  const inboundRoutes =
    mode === 'RoundTrip' ? await findRoutesForLeg(to, from, returnDate as string, request.id, 'inbound') : undefined;

  // Refresh the short-lived by-ID instance store on every access (cache hit or miss) so
  // Flights/Routes shown in this response stay resolvable by ID (seat/price selection,
  // flight detail) for the instance TTL from now, not just from when they were first generated.
  storeRoutes(inboundRoutes ? [...outboundRoutes, ...inboundRoutes] : outboundRoutes);

  return {
    from,
    to,
    departureDate,
    returnDate,
    id: generateId(),
    mode,
    outbound: outboundRoutes.map(formatRoute),
    inbound: inboundRoutes?.map(formatRoute),
  };
}

export async function getFlightDetailBase(request: FlightDetailRequest): Promise<FormattedFlight> {
  const { id } = request.params;

  logFlow({
    reqId: request.id,
    flow: 'flight-detail',
    step: 'lookup',
    data: { id },
  });

  // Flights only live in the short-lived by-ID instance store (populated by searchFlightsBase);
  // there's no from/to/date to reconstruct a query from — the id carries no route info.
  const flight = getStoredFlight(id);

  if (!flight) {
    throw new ApiError(404, 'FLIGHT_NOT_FOUND', 'Flight not found');
  }

  logFlow({
    reqId: request.id,
    flow: 'flight-detail',
    step: 'lookup-found',
    data: { id, airline: flight.travelInfo.airline },
  });

  return formatFlight(flight);
}

export interface PurchaseBody {
  mode: SearchMode;
  outboundId: string;
  inboundId?: string;
  currency: string;
  price: number;
}

export type PurchaseRequest = FastifyRequest<{ Body: PurchaseBody }>;

export interface PurchaseBaseResult {
  bookingCode: string;
  mode: SearchMode;
  currency: string;
  price: number;
  outbound: FormattedRoute;
  inbound?: FormattedRoute;
}

// Consistent with the 2-decimal rounding every price in this scenario is generated with (see
// generator.ts) — a client-submitted price is allowed to drift by up to this much from the
// server-derived total before being rejected as a mismatch.
const PRICE_TOLERANCE = 0.02;

function routeTotalForCurrency(route: Route, currency: string): number {
  const pricing = route.pricing.find((p) => p.currency === currency);
  if (!pricing) {
    throw new ApiError(400, 'CURRENCY_NOT_AVAILABLE', `Route ${route.id} is not available in currency ${currency}`);
  }
  // V2 only sells regular seats, so the Route's already-aggregated `minimum` fare (see
  // aggregateRouteMinimumPricing in generator.ts) is the full price for that leg — no need to
  // re-derive it from individual seat classes.
  return pricing.minimum;
}

export async function purchaseBase(request: PurchaseRequest): Promise<PurchaseBaseResult> {
  const { outboundId, inboundId, currency, price } = request.body;
  const modeParam = request.body.mode?.toLowerCase();

  if (modeParam !== 'oneway' && modeParam !== 'roundtrip') {
    throw new ApiError(400, 'INVALID_MODE', "mode must be 'OneWay' or 'RoundTrip'");
  }
  const mode: SearchMode = modeParam === 'roundtrip' ? 'RoundTrip' : 'OneWay';

  if (mode === 'RoundTrip' && !inboundId) {
    throw new ApiError(400, 'INBOUND_ID_REQUIRED', 'inboundId is required when mode is RoundTrip');
  }

  logFlow({ reqId: request.id, flow: 'purchase', step: 'lookup', data: { mode, outboundId, inboundId } });

  const outboundRoute = getStoredRoute(outboundId);
  if (!outboundRoute) {
    throw new ApiError(404, 'ROUTE_NOT_FOUND', `Outbound route ${outboundId} not found or expired`);
  }

  let inboundRoute: Route | undefined;
  if (mode === 'RoundTrip') {
    inboundRoute = getStoredRoute(inboundId as string);
    if (!inboundRoute) {
      throw new ApiError(404, 'ROUTE_NOT_FOUND', `Inbound route ${inboundId} not found or expired`);
    }

    // A round trip must return between the same two airports the outbound leg connected.
    if (
      outboundRoute.departure.airport !== inboundRoute.arrival.airport ||
      outboundRoute.arrival.airport !== inboundRoute.departure.airport
    ) {
      throw new ApiError(
        400,
        'ROUTE_MISMATCH',
        'Inbound route must depart from and arrive at the same airports as the outbound route, reversed',
      );
    }
  }

  const expectedTotal =
    Math.round(
      (routeTotalForCurrency(outboundRoute, currency) +
        (inboundRoute ? routeTotalForCurrency(inboundRoute, currency) : 0)) *
        100,
    ) / 100;

  if (Math.abs(expectedTotal - price) > PRICE_TOLERANCE) {
    throw new ApiError(
      400,
      'PRICE_MISMATCH',
      `Informed price ${price} does not match the expected total ${expectedTotal}`,
      {
        expected: expectedTotal,
        informed: price,
      },
    );
  }

  logFlow({
    reqId: request.id,
    flow: 'purchase',
    step: 'confirmed',
    data: { mode, outboundId, inboundId, currency, expectedTotal },
  });

  return {
    bookingCode: faker.airline.recordLocator(),
    mode,
    currency,
    price,
    outbound: formatRoute(outboundRoute),
    inbound: inboundRoute ? formatRoute(inboundRoute) : undefined,
  };
}

export async function listAirportsBase(request: FastifyRequest): Promise<Airport[]> {
  logFlow({
    reqId: request.id,
    flow: 'list-airports',
    step: 'fetch',
  });

  const cacheKeyVal = cacheKey(NAMESPACE, 'airports');
  let airports = getCached<Airport[]>(cacheKeyVal);

  if (!airports) {
    airports = await store.getAirports();
    setCached(cacheKeyVal, airports, LARGE_CACHE_TTL);

    logFlow({
      reqId: request.id,
      flow: 'list-airports',
      step: 'generated',
      data: { count: airports.length },
    });
  } else {
    logFlow({
      reqId: request.id,
      flow: 'list-airports',
      step: 'cached',
    });
  }

  return airports;
}

export async function listCitiesBase(request: FastifyRequest): Promise<City[]> {
  logFlow({
    reqId: request.id,
    flow: 'list-cities',
    step: 'fetch',
  });

  const cacheKeyVal = cacheKey(NAMESPACE, 'cities');
  let cities = getCached<City[]>(cacheKeyVal);

  if (!cities) {
    cities = await store.getCities();
    setCached(cacheKeyVal, cities, LARGE_CACHE_TTL);

    logFlow({
      reqId: request.id,
      flow: 'list-cities',
      step: 'generated',
      data: { count: cities.length },
    });
  } else {
    logFlow({
      reqId: request.id,
      flow: 'list-cities',
      step: 'cached',
    });
  }

  return cities;
}
