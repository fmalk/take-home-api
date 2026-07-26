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
import { getStoredRoute, storeSearchResults, getStoredSearchResults } from '../standard/instance-store.js';
import { logFlow } from '../../../core/logger.js';
import type { FormattedFlight, FormattedRoute } from '../standard/formatters.js';
import { formatRoute } from '../standard/formatters.js';
import type { Airport, City, Route, Flight } from '../standard/types.js';
import type { V4Airport, V4Flight, V4Route, FlightSeatSelection, SearchPagesQuery } from './types.js';
import { SEARCH_PAGE_SIZE } from './types.js';

export type { SearchFlightsQuery, FlightIdParams, SearchFlightsRequest, FlightDetailRequest };

// v4 airports drop only the internal category flags; icao/utcOffset/lat/long stay (full spec).
function toV4Airport({
  isStandard: _isStandard,
  isRegional: _isRegional,
  isHub: _isHub,
  isIsolated: _isIsolated,
  ...airport
}: Airport): V4Airport {
  return airport;
}

// v4 flights drop the flat `price` simplification but keep every seat class an airline offers
// (regular/economy/businessClass/firstClass) — no pricing.filter trim, same as v3.
function toV4Flight({ price: _price, ...flight }: FormattedFlight): V4Flight {
  return flight;
}

// v4 routes drop the flat `price` simplification too; their `pricing` is already the
// cheapest-bookable-fare `minimum` per currency (see aggregateRouteMinimumPricing in
// standard/generator.ts), not a specific seat class, so it needs no further trimming here.
function toV4Route({ price: _price, flights, ...route }: FormattedRoute): V4Route {
  return { ...route, flights: flights.map(toV4Flight) };
}

export interface SearchFlightsResult extends Omit<SearchFlightsQuery, 'mode'> {
  id: string;
  mode: 'OneWay' | 'RoundTrip';
  outbound: V4Route[];
  outboundCurrentPage: number;
  outboundTotalPages: number;
  inbound?: V4Route[];
  inboundCurrentPage?: number;
  inboundTotalPages?: number;
}

function totalPages(count: number): number {
  return Math.max(1, Math.ceil(count / SEARCH_PAGE_SIZE));
}

export async function searchFlights(request: SearchFlightsRequest): Promise<SearchFlightsResult> {
  const { from, to, departureDate, returnDate, id, mode, outbound, inbound } = await searchFlightsBase(request);

  // Route/Flight instances (formatRoute's source) are only resolvable by ID for the instance
  // store TTL, same window /search/pages needs to still be able to slice a later page — so the
  // full route lists are stashed here, keyed by this search's own id, rather than re-derived.
  storeSearchResults(id, { outbound, inbound });

  return {
    from,
    to,
    departureDate,
    returnDate,
    id,
    mode,
    outbound: outbound.slice(0, SEARCH_PAGE_SIZE).map(toV4Route),
    outboundCurrentPage: 1,
    outboundTotalPages: totalPages(outbound.length),
    inbound: inbound ? inbound.slice(0, SEARCH_PAGE_SIZE).map(toV4Route) : undefined,
    inboundCurrentPage: inbound ? 1 : undefined,
    inboundTotalPages: inbound ? totalPages(inbound.length) : undefined,
  };
}

export type SearchPagesRequest = FastifyRequest<{ Querystring: SearchPagesQuery }>;

export interface SearchPagesResult {
  id: string;
  outboundPage?: number;
  outbound?: V4Route[];
  inboundPage?: number;
  inbound?: V4Route[];
}

function parsePageParam(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    throw new ApiError(400, 'INVALID_PAGE', `${name} must be a positive integer`);
  }
  return page;
}

function pageSlice(routes: FormattedRoute[], page: number, legName: string): V4Route[] {
  const total = totalPages(routes.length);
  if (page > total) {
    throw new ApiError(400, 'PAGE_EXCEEDED', `${legName}Page ${page} exceeds the available ${total} page(s)`);
  }
  return routes.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE).map(toV4Route);
}

export async function getSearchPage(request: SearchPagesRequest): Promise<SearchPagesResult> {
  const { id, outboundPage: outboundPageParam, inboundPage: inboundPageParam } = request.query;

  const outboundPage = parsePageParam('outbound', outboundPageParam);
  const inboundPage = parsePageParam('inbound', inboundPageParam);

  if (outboundPage === undefined && inboundPage === undefined) {
    throw new ApiError(400, 'PAGE_REQUIRED', 'outboundPage or inboundPage is required');
  }

  const stored = getStoredSearchResults(id);
  if (!stored) {
    throw new ApiError(404, 'SEARCH_NOT_FOUND', `Search ${id} not found or expired`);
  }

  if (inboundPage !== undefined && !stored.inbound) {
    throw new ApiError(400, 'NO_INBOUND', `Search ${id} has no inbound leg`);
  }

  logFlow({ reqId: request.id, flow: 'search-pages', step: 'lookup', data: { id, outboundPage, inboundPage } });

  return {
    id,
    outboundPage,
    outbound: outboundPage !== undefined ? pageSlice(stored.outbound, outboundPage, 'outbound') : undefined,
    inboundPage,
    inbound:
      inboundPage !== undefined ? pageSlice(stored.inbound as FormattedRoute[], inboundPage, 'inbound') : undefined,
  };
}

export async function getFlightDetail(request: FlightDetailRequest): Promise<V4Flight> {
  const flight = await getFlightDetailBase(request);
  return toV4Flight(flight);
}

export interface PurchaseBody {
  mode: SearchMode;
  outboundId: string;
  inboundId?: string;
  currency: string;
  seats: FlightSeatSelection[];
}

export type PurchaseRequest = FastifyRequest<{ Body: PurchaseBody }>;

export interface PurchaseResult {
  bookingCode: string;
  mode: 'OneWay' | 'RoundTrip';
  currency: string;
  price: number;
  outbound: V4Route;
  inbound?: V4Route;
  user: AuthUser;
}

// Consistent with the 2-decimal rounding every price in this scenario is generated with (see
// generator.ts) — a client-submitted seat price is allowed to drift by up to this much from the
// server-derived price before being rejected as a mismatch.
const PRICE_TOLERANCE = 0.02;

// v4 sells every seat class individually (unlike v1/v2's flat/regular-only `price`), so purchase
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

  if (Math.abs(actualPrice - selection.price) > PRICE_TOLERANCE) {
    throw new ApiError(
      400,
      'PRICE_MISMATCH',
      `Informed price for flight ${selection.flightId} (${selection.seatClass}) does not match the expected price ${actualPrice}`,
      { expected: actualPrice, informed: selection.price },
    );
  }

  return actualPrice;
}

// Auth is bound to a single createAuthController instance (see v4/routes.ts), so purchase takes
// its getUserBase as a dependency rather than re-instantiating the controller here.
export function createPurchase(
  getUserBase: (request: UserRequest) => Promise<AuthUser>,
): (request: PurchaseRequest) => Promise<PurchaseResult> {
  return async function purchase(request: PurchaseRequest): Promise<PurchaseResult> {
    const user = await getUserBase(request);
    const { outboundId, inboundId, currency, seats } = request.body;
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

    if (!Array.isArray(seats) || seats.length === 0) {
      throw new ApiError(400, 'SEATS_REQUIRED', 'seats must include one seat selection per flight');
    }

    const selectedFlightIds = new Set(seats.map((s) => s.flightId));
    if (selectedFlightIds.size !== seats.length) {
      throw new ApiError(400, 'DUPLICATE_FLIGHT_SELECTION', 'seats must include at most one selection per flight');
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

    for (const selection of seats) {
      if (selection.currency !== currency) {
        throw new ApiError(
          400,
          'CURRENCY_MISMATCH',
          `Seat selection for flight ${selection.flightId} is in currency ${selection.currency}, expected ${currency}`,
        );
      }
    }

    const expectedTotal =
      Math.round(seats.reduce((sum, selection) => sum + validateSelection(selection, routes, currency), 0) * 100) / 100;

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
      outbound: toV4Route(formatRoute(outboundRoute)),
      inbound: inboundRoute ? toV4Route(formatRoute(inboundRoute)) : undefined,
      user,
    };
  };
}

export async function listAirports(request: FastifyRequest): Promise<{ airports: V4Airport[] }> {
  const airports = await listAirportsBase(request);
  return { airports: airports.map(toV4Airport) };
}

export async function listCities(request: FastifyRequest): Promise<{ cities: City[] }> {
  const cities = await listCitiesBase(request);
  return { cities };
}
