import type { FastifyRequest } from 'fastify';
import {
  searchFlightsBase,
  getFlightDetailBase,
  listAirportsBase,
  listCitiesBase,
  type SearchFlightsQuery,
  type FlightIdParams,
  type SearchFlightsRequest,
  type FlightDetailRequest,
} from '../standard/controller.js';
import type { FormattedFlight, FormattedRoute } from '../standard/formatters.js';
import type { Airport, City } from '../standard/types.js';
import type { V1Airport, V1Flight, V1Route } from './types.js';

export type { SearchFlightsQuery, FlightIdParams, SearchFlightsRequest, FlightDetailRequest };

// v1 airports drop icao/utcOffset/lat/long and the internal category flags.
function toV1Airport({
  icao: _icao,
  utcOffset: _utcOffset,
  lat: _lat,
  long: _long,
  isStandard: _isStandard,
  isRegional: _isRegional,
  isHub: _isHub,
  isIsolated: _isIsolated,
  ...airport
}: Airport): V1Airport {
  return airport;
}

// v1 flights/routes keep the flat `price` and drop the per-class `pricing` breakdown.
function toV1Flight({ pricing: _pricing, ...flight }: FormattedFlight): V1Flight {
  return flight;
}

function toV1Route({ pricing: _pricing, flights, ...route }: FormattedRoute): V1Route {
  return { ...route, flights: flights.map(toV1Flight) };
}

// v1 is one-way only (its querystring schema rejects mode/returnDate outright), so mode is
// always 'OneWay' and there's never an inbound leg to expose.
export interface SearchFlightsResult {
  from: string;
  to: string;
  departureDate: string;
  id: string;
  mode: 'OneWay';
  outbound: V1Route[];
}

export async function searchFlights(request: SearchFlightsRequest): Promise<SearchFlightsResult> {
  const { from, to, departureDate, id, outbound } = await searchFlightsBase(request);
  return { from, to, departureDate, id, mode: 'OneWay', outbound: outbound.map(toV1Route) };
}

export async function getFlightDetail(request: FlightDetailRequest): Promise<V1Flight> {
  const flight = await getFlightDetailBase(request);
  return toV1Flight(flight);
}

export async function listAirports(request: FastifyRequest): Promise<{ airports: V1Airport[] }> {
  const airports = await listAirportsBase(request);
  return { airports: airports.map(toV1Airport) };
}

export async function listCities(request: FastifyRequest): Promise<{ cities: City[] }> {
  const cities = await listCitiesBase(request);
  return { cities };
}
