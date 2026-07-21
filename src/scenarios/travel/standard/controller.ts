import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../../types.js';
import { cacheKey, getCached, setCached } from '../../../core/cache.js';
import { findDirectFlights, findConnectingRoutes, applyTimeFlow, groupRoutes, generateId } from './generator.js';
import { TravelStore } from './store.js';
import { storeRoutes, getStoredFlight } from './instance-store.js';
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
async function findRoutesForLeg(from: string, to: string, date: string, reqId: string, leg: 'outbound' | 'inbound'): Promise<Route[]> {
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
  const mode: SearchMode = request.query.mode ?? 'OneWay';

  if (mode === 'RoundTrip' && !returnDate) {
    throw new ApiError(400, 'RETURN_DATE_REQUIRED', 'returnDate is required when mode is RoundTrip');
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
