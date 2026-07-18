import type { FastifyRequest } from 'fastify';
import { ApiError } from '../../../types/index.js';
import { cacheKey, getCached, setCached } from '../../../core/cache.js';
import { generateFlights } from './generator.js';
import { TravelStore } from '../standard/store.js';
import { logFlow } from '../../../core/logger.js';
import type { Flight, Airport, City } from '../standard/index.js';
import type { V1Airport } from './types.js';

const CACHE_TTL = 3600;
const LARGE_CACHE_TTL = 3600 * 24;
const SCENARIO = 'travel';
const NAMESPACE = `${SCENARIO}:v1`;

const store = new TravelStore();

// v1 airports drop icao/utcOffset from the standard shape.
function toV1Airport({ icao: _icao, utcOffset: _utcOffset, ...airport }: Airport): V1Airport {
  return airport;
}

export interface SearchFlightsQuery {
  from: string;
  to: string;
  date: string;
}

export interface FlightIdParams {
  id: string;
}

export type SearchFlightsRequest = FastifyRequest<{ Querystring: SearchFlightsQuery }>;
export type FlightDetailRequest = FastifyRequest<{ Params: FlightIdParams }>;

export interface SearchFlightsResult extends SearchFlightsQuery {
  routes: Flight[];
}

export async function searchFlights(request: SearchFlightsRequest): Promise<SearchFlightsResult> {
  const { from, to, date } = request.query;

  logFlow({
    reqId: request.id,
    flow: 'flight-search',
    step: 'query',
    data: { from, to, date },
  });

  const cacheKeyVal = cacheKey(NAMESPACE, 'flights', from, to, date);
  let flightsData = getCached<Flight[]>(cacheKeyVal);

  if (!flightsData) {
    const generated = generateFlights(from, to, date, 5);
    setCached(cacheKeyVal, generated, CACHE_TTL);

    logFlow({
      reqId: request.id,
      flow: 'flight-search',
      step: 'generated',
      data: { count: generated.length },
    });
    flightsData = generated;
  } else {
    logFlow({
      reqId: request.id,
      flow: 'flight-search',
      step: 'cached',
    });
  }

  return {
    from,
    to,
    date,
    routes: flightsData,
  };
}

export async function getFlightDetail(request: FlightDetailRequest): Promise<Flight> {
  const { id } = request.params;

  logFlow({
    reqId: request.id,
    flow: 'flight-detail',
    step: 'lookup',
    data: { id },
  });

  const parts = id.split('-');
  if (parts.length < 4) {
    throw new ApiError(400, 'INVALID_FLIGHT_ID', 'Invalid flight ID format');
  }

  const from = parts[0].toUpperCase();
  const to = parts[1].toUpperCase();
  const date = parts.slice(2, -1).join('-');

  const cacheKeyVal = cacheKey(NAMESPACE, 'flights', from, to, date);
  let flightsData = getCached<Flight[]>(cacheKeyVal);

  if (!flightsData) {
    const generated = generateFlights(from, to, date, 5);
    setCached(cacheKeyVal, generated, CACHE_TTL);
    flightsData = generated;
  }

  const flight = store.getFlight(flightsData, id);

  if (!flight) {
    throw new ApiError(404, 'FLIGHT_NOT_FOUND', 'Flight not found');
  }

  logFlow({
    reqId: request.id,
    flow: 'flight-detail',
    step: 'lookup-found',
    data: { id, airline: flight.airline },
  });

  return flight;
}

export async function listAirports(request: FastifyRequest): Promise<{ airports: V1Airport[] }> {
  logFlow({
    reqId: request.id,
    flow: 'list-airports',
    step: 'fetch',
  });

  const cacheKeyVal = cacheKey(NAMESPACE, 'airports');
  let airports = getCached<V1Airport[]>(cacheKeyVal);

  if (!airports) {
    airports = (await store.getAirports()).map(toV1Airport);
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

  return { airports };
}

export async function listCities(request: FastifyRequest): Promise<{ cities: City[] }> {
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

  return { cities };
}
