import type { FastifyRequest } from 'fastify';
import { faker } from '@faker-js/faker';
import { ApiError } from '../../../types.js';
import type { AuthUser, UserRequest } from '../../../core/auth.js';
import {
  searchFlightsBase,
  getFlightDetailBase,
  listAirportsBase,
  listCitiesBase,
  type SearchFlightsQuery,
  type FlightIdParams,
  type SearchFlightsRequest,
  type FlightDetailRequest,
  type SearchMode,
} from '../standard/controller.js';
import { getStoredRoute } from '../standard/instance-store.js';
import { logFlow } from '../../../core/logger.js';
import type { FormattedFlight, FormattedRoute } from '../standard/formatters.js';
import { formatRoute } from '../standard/formatters.js';
import type { Airport, City, Route, Flight } from '../standard/types.js';
import type { V3Airport, V3Flight, V3Route, FlightSeatSelection } from './types.js';

export type { SearchFlightsQuery, FlightIdParams, SearchFlightsRequest, FlightDetailRequest };

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

export interface PurchaseBody {
  mode: SearchMode;
  outboundId: string;
  inboundId?: string;
  currency: string;
  pricing: FlightSeatSelection[];
}

export type PurchaseRequest = FastifyRequest<{ Body: PurchaseBody }>;

export interface PurchaseResult {
  bookingCode: string;
  mode: 'OneWay' | 'RoundTrip';
  currency: string;
  price: number;
  outbound: V3Route;
  inbound?: V3Route;
  user: AuthUser;
}

// Consistent with the 2-decimal rounding every price in this scenario is generated with (see
// generator.ts) — a client-submitted seat price is allowed to drift by up to this much from the
// server-derived price before being rejected as a mismatch.
const PRICE_TOLERANCE = 0.02;

// v3 sells every seat class individually (unlike v1/v2's flat/regular-only `price`), so purchase
// takes one FlightSeatSelection per flight — across both legs — instead of a single total price;
// each selection is validated against that flight's stored pricing for the request currency, and
// the expected total is the sum of the chosen seats rather than the route's aggregated `minimum`.
function findFlightInRoutes(flightId: string, routes: Route[]): Flight | undefined {
  for (const route of routes) {
    const flight = route.flights.find((f) => f.id === flightId);
    if (flight) return flight;
  }
  return undefined;
}

function validateSelection(selection: FlightSeatSelection, routes: Route[], currency: string): number {
  const flight = findFlightInRoutes(selection.flightId, routes);
  if (!flight) {
    throw new ApiError(404, 'FLIGHT_NOT_FOUND', `Flight ${selection.flightId} not found or expired`);
  }

  const pricing = flight.pricing.find((p) => p.currency === currency);
  if (!pricing) {
    throw new ApiError(
      400,
      'CURRENCY_NOT_AVAILABLE',
      `Flight ${selection.flightId} is not available in currency ${currency}`,
    );
  }

  const actualPrice = pricing[selection.seatClass];
  if (actualPrice === undefined) {
    throw new ApiError(
      400,
      'SEAT_CLASS_NOT_AVAILABLE',
      `Flight ${selection.flightId} does not offer seat class ${selection.seatClass}`,
    );
  }

  const informedPrice = selection.pricing[selection.seatClass];
  if (informedPrice === undefined || Math.abs(actualPrice - informedPrice) > PRICE_TOLERANCE) {
    throw new ApiError(
      400,
      'PRICE_MISMATCH',
      `Informed price for flight ${selection.flightId} (${selection.seatClass}) does not match the expected price ${actualPrice}`,
      { expected: actualPrice, informed: informedPrice },
    );
  }

  return actualPrice;
}

// Auth is bound to a single createAuthController instance (see v3/routes.ts), so purchase takes
// its getUserBase as a dependency rather than re-instantiating the controller here.
export function createPurchase(
  getUserBase: (request: UserRequest) => Promise<AuthUser>,
): (request: PurchaseRequest) => Promise<PurchaseResult> {
  return async function purchase(request: PurchaseRequest): Promise<PurchaseResult> {
    const user = await getUserBase(request);
    const { outboundId, inboundId, currency, pricing } = request.body;
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

    const routes = inboundRoute ? [outboundRoute, inboundRoute] : [outboundRoute];
    const allFlightIds = new Set(routes.flatMap((r) => r.flights.map((f) => f.id)));

    if (!Array.isArray(pricing) || pricing.length === 0) {
      throw new ApiError(400, 'PRICING_REQUIRED', 'pricing must include one seat selection per flight');
    }

    const selectedFlightIds = new Set(pricing.map((p) => p.flightId));
    if (selectedFlightIds.size !== pricing.length) {
      throw new ApiError(400, 'DUPLICATE_FLIGHT_SELECTION', 'pricing must include at most one selection per flight');
    }

    for (const flightId of allFlightIds) {
      if (!selectedFlightIds.has(flightId)) {
        throw new ApiError(400, 'MISSING_FLIGHT_SELECTION', `Missing a seat selection for flight ${flightId}`);
      }
    }
    for (const flightId of selectedFlightIds) {
      if (!allFlightIds.has(flightId)) {
        throw new ApiError(
          400,
          'FLIGHT_NOT_IN_ROUTE',
          `Flight ${flightId} is not part of the selected outbound/inbound routes`,
        );
      }
    }

    const expectedTotal =
      Math.round(pricing.reduce((sum, selection) => sum + validateSelection(selection, routes, currency), 0) * 100) /
      100;

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
      price: expectedTotal,
      outbound: toV3Route(formatRoute(outboundRoute)),
      inbound: inboundRoute ? toV3Route(formatRoute(inboundRoute)) : undefined,
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
