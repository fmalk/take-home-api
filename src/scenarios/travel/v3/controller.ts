import type { FastifyRequest } from 'fastify';
import type { AuthUser, UserRequest } from '../../../core/auth.js';
import {
  searchFlightsBase,
  getFlightDetailBase,
  listAirportsBase,
  listCitiesBase,
  purchaseBase,
  type SearchFlightsQuery,
  type FlightIdParams,
  type SearchFlightsRequest,
  type FlightDetailRequest,
  type PurchaseBody,
  type PurchaseRequest,
} from '../standard/controller.js';
import type { FormattedFlight, FormattedRoute } from '../standard/formatters.js';
import type { Airport, City } from '../standard/types.js';
import type { V3Airport, V3Flight, V3Route } from './types.js';

export type {
  SearchFlightsQuery,
  FlightIdParams,
  SearchFlightsRequest,
  FlightDetailRequest,
  PurchaseBody,
  PurchaseRequest,
};

// v3 airports drop only the internal category flags; icao/utcOffset/lat/long stay (full spec).
function toV3Airport({
  isStandard: _isStandard,
  isRegional: _isRegional,
  isHub: _isHub,
  isIsolated: _isIsolated,
  ...airport
}: Airport): V3Airport {
  return airport;
}

// v3 flights drop the flat `price` simplification but, unlike v2, keep every seat class an
// airline offers (regular/economy/businessClass/firstClass) — no pricing.filter trim.
function toV3Flight({ price: _price, ...flight }: FormattedFlight): V3Flight {
  return flight;
}

// v3 routes drop the flat `price` simplification too; their `pricing` is already the
// cheapest-bookable-fare `minimum` per currency (see aggregateRouteMinimumPricing in
// standard/generator.ts), not a specific seat class, so it needs no further trimming here.
function toV3Route({ price: _price, flights, ...route }: FormattedRoute): V3Route {
  return { ...route, flights: flights.map(toV3Flight) };
}

export interface SearchFlightsResult extends Omit<SearchFlightsQuery, 'mode'> {
  id: string;
  mode: 'OneWay' | 'RoundTrip';
  outbound: V3Route[];
  inbound?: V3Route[];
}

export async function searchFlights(request: SearchFlightsRequest): Promise<SearchFlightsResult> {
  const { from, to, departureDate, returnDate, id, mode, outbound, inbound } = await searchFlightsBase(request);
  return {
    from,
    to,
    departureDate,
    returnDate,
    id,
    mode,
    outbound: outbound.map(toV3Route),
    inbound: inbound?.map(toV3Route),
  };
}

export async function getFlightDetail(request: FlightDetailRequest): Promise<V3Flight> {
  const flight = await getFlightDetailBase(request);
  return toV3Flight(flight);
}

export interface PurchaseResult {
  bookingCode: string;
  mode: 'OneWay' | 'RoundTrip';
  currency: string;
  price: number;
  outbound: V3Route;
  inbound?: V3Route;
  user: AuthUser;
}

// Auth is bound to a single createAuthController instance (see v3/routes.ts), so purchase takes
// its getUserBase as a dependency rather than re-instantiating the controller here.
export function createPurchase(
  getUserBase: (request: UserRequest) => Promise<AuthUser>,
): (request: PurchaseRequest) => Promise<PurchaseResult> {
  return async function purchase(request: PurchaseRequest): Promise<PurchaseResult> {
    const user = await getUserBase(request);
    const { outbound, inbound, ...rest } = await purchaseBase(request);
    return {
      ...rest,
      outbound: toV3Route(outbound),
      inbound: inbound ? toV3Route(inbound) : undefined,
      user,
    };
  };
}

export async function listAirports(request: FastifyRequest): Promise<{ airports: V3Airport[] }> {
  const airports = await listAirportsBase(request);
  return { airports: airports.map(toV3Airport) };
}

export async function listCities(request: FastifyRequest): Promise<{ cities: City[] }> {
  const cities = await listCitiesBase(request);
  return { cities };
}
