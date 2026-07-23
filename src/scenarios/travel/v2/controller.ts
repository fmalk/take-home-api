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
import type { V2Airport, V2Flight, V2Route } from './types.js';

export type {
  SearchFlightsQuery,
  FlightIdParams,
  SearchFlightsRequest,
  FlightDetailRequest,
  PurchaseBody,
  PurchaseRequest,
};

// v2 airports drop only the internal category flags; icao/utcOffset/lat/long stay (full spec).
function toV2Airport({
  isStandard: _isStandard,
  isRegional: _isRegional,
  isHub: _isHub,
  isIsolated: _isIsolated,
  ...airport
}: Airport): V2Airport {
  return airport;
}

// v2 flights drop the flat `price` simplification and only ever sell the `regular` tier
// (economy/business/first stay reserved for a future, more granular version), across every
// currency the flight offers.
function toV2Flight({ price: _price, pricing, ...flight }: FormattedFlight): V2Flight {
  return { ...flight, pricing: pricing.filter((p) => p.regular !== undefined) };
}

// v2 routes drop the flat `price` simplification too; their `pricing` is already the
// cheapest-bookable-fare `minimum` per currency (see aggregateRouteMinimumPricing in
// standard/generator.ts), not a specific seat class, so it needs no further trimming here.
function toV2Route({ price: _price, flights, ...route }: FormattedRoute): V2Route {
  return { ...route, flights: flights.map(toV2Flight) };
}

export interface SearchFlightsResult extends Omit<SearchFlightsQuery, 'mode'> {
  id: string;
  mode: 'OneWay' | 'RoundTrip';
  outbound: V2Route[];
  inbound?: V2Route[];
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
    outbound: outbound.map(toV2Route),
    inbound: inbound?.map(toV2Route),
  };
}

export async function getFlightDetail(request: FlightDetailRequest): Promise<V2Flight> {
  const flight = await getFlightDetailBase(request);
  return toV2Flight(flight);
}

export interface PurchaseResult {
  bookingCode: string;
  mode: 'OneWay' | 'RoundTrip';
  currency: string;
  price: number;
  outbound: V2Route;
  inbound?: V2Route;
  user: AuthUser;
}

// Auth is bound to a single createAuthController instance (see v2/routes.ts), so purchase takes
// its getUserBase as a dependency rather than re-instantiating the controller here.
export function createPurchase(
  getUserBase: (request: UserRequest) => Promise<AuthUser>,
): (request: PurchaseRequest) => Promise<PurchaseResult> {
  return async function purchase(request: PurchaseRequest): Promise<PurchaseResult> {
    const user = await getUserBase(request);
    const { outbound, inbound, ...rest } = await purchaseBase(request);
    return {
      ...rest,
      outbound: toV2Route(outbound),
      inbound: inbound ? toV2Route(inbound) : undefined,
      user,
    };
  };
}

export async function listAirports(request: FastifyRequest): Promise<{ airports: V2Airport[] }> {
  const airports = await listAirportsBase(request);
  return { airports: airports.map(toV2Airport) };
}

export async function listCities(request: FastifyRequest): Promise<{ cities: City[] }> {
  const cities = await listCitiesBase(request);
  return { cities };
}
