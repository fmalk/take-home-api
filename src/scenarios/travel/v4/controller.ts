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
import type { Airport, City, Route, Flight, FlightPricing, RoutePricing } from '../standard/types.js';
import type { V4Airport, V4Flight, V4Route, FlightSeatSelection, SearchPagesQuery, SeatClass } from './types.js';
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

// TAK-27: within RECENT_DATE_WINDOW_DAYS of "now", v4 search presents each flight with one of
// its seat classes randomly withheld (see dropRandomSeatClass) — a deliberate "last-minute
// booking, availability is patchy" flavor quirk, v4 only.
//
// KNOWN LIMITATION (intentional, presentation-only): this trim is applied to a per-request clone
// of the formatted routes right before the v4 search response is built, not to the underlying
// stored Route/Flight instances (shared across every version via the `travel:base` cache and the
// `travel:instances` by-ID store, see standard/controller.ts and standard/instance-store.ts).
// Mutating those shared instances would leak this v4-only quirk into v1/v2/v3's results for the
// same flights. Consequence: GET /v4/flights/:id and POST /v4/purchase still resolve the full,
// untrimmed pricing for a flight whose class was hidden from the search response that surfaced
// it — a class dropped from search can still be looked up/booked directly by ID. Fine for this
// scenario's educational purpose; a production system would need the trim to be consistent
// end-to-end (e.g. a per-version stored snapshot) instead.
const RECENT_DATE_WINDOW_DAYS = 15;

function isWithinRecentDateWindow(date: string): boolean {
  const target = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return false;
  const diffDays = (target - Date.now()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= RECENT_DATE_WINDOW_DAYS;
}

const ALL_SEAT_CLASSES: SeatClass[] = ['regular', 'economy', 'businessClass', 'firstClass'];

function seatClassesOffered(pricing: FlightPricing[]): SeatClass[] {
  return ALL_SEAT_CLASSES.filter((seatClass) => pricing.some((p) => p[seatClass] !== undefined));
}

// Drops every currency row for one randomly-picked seat class the flight offers — never the only
// class it has (a flight must always be bookable in at least one class). Deliberately crude per
// TAK-27: no seat-pool rebalancing across the remaining classes — each surviving class keeps
// whatever per-class `available` it already had (see applySeatClassSplit in generator.ts).
//
// Flight-level `available` (the whole-plane pool Route aggregation mins across legs) DOES need
// to shrink here, though: it was generated as the sum of every class's independent pool (e.g. 40
// regular + 50 economy = 90), so once a class's pricing rows are gone, `available` must drop to
// just the surviving classes' pools — otherwise it keeps advertising seats behind a class the
// response no longer shows.
function dropRandomSeatClass(flight: FormattedFlight): FormattedFlight {
  const classes = seatClassesOffered(flight.pricing);
  if (classes.length <= 1) return flight;

  const dropped = faker.helpers.arrayElement(classes);
  const pricing = flight.pricing.filter((p) => p[dropped] === undefined);
  const available = Math.max(...pricing.map((p) => p.available));
  return { ...flight, pricing, available };
}

// Route-level `pricing.minimum` (see aggregateRouteMinimumPricing in standard/generator.ts) was
// computed from the pre-trim flights and can reference a class/currency this trim just hid from
// one of the route's legs; recomputed here so the route summary never promises a fare its own
// (trimmed) flights no longer show. Mirrors that function's cheapest-of-regular/economy rule and
// its "only currencies offered on every leg" rule, applied to the trimmed pricing instead.
const MINIMUM_CLASS_ORDER: SeatClass[] = ['regular', 'economy'];

function legMinimumPriceByCurrency(flight: FormattedFlight): Map<string, number> {
  const minimums = new Map<string, number>();
  for (const entry of flight.pricing) {
    const seatClass = MINIMUM_CLASS_ORDER.find((c) => entry[c] !== undefined);
    if (!seatClass) continue;
    const price = entry[seatClass] as number;
    const current = minimums.get(entry.currency);
    if (current === undefined || price < current) minimums.set(entry.currency, price);
  }
  return minimums;
}

function recomputeRouteMinimumPricing(flights: FormattedFlight[], routeAvailable: number): RoutePricing[] {
  if (flights.length === 0) return [];

  const [firstMinimums, ...restMinimums] = flights.map(legMinimumPriceByCurrency);
  const pricing: RoutePricing[] = [];

  for (const [currency, firstAmount] of firstMinimums) {
    let total = firstAmount;
    let offeredOnEveryLeg = true;

    for (const legMinimums of restMinimums) {
      const amount = legMinimums.get(currency);
      if (amount === undefined) {
        offeredOnEveryLeg = false;
        break;
      }
      total += amount;
    }

    if (offeredOnEveryLeg) {
      pricing.push({ currency, available: routeAvailable, minimum: Math.round(total * 100) / 100 });
    }
  }
  return pricing;
}

// Applies the TAK-27 seat-class trim to every flight in a route (when the route's leg date falls
// in the recent-date window). Since a trimmed flight's own `available` can shrink (see
// dropRandomSeatClass), the route's `available` (min across legs, same rule as groupRoutes in
// generator.ts) and `pricing.minimum` are both recomputed off the trimmed flights so neither one
// keeps advertising a seat count the response no longer backs up.
function applyRecentDateSeatTrim(route: FormattedRoute): FormattedRoute {
  const flights = route.flights.map(dropRandomSeatClass);
  const available = Math.min(...flights.map((f) => f.available));
  return { ...route, flights, available, pricing: recomputeRouteMinimumPricing(flights, available) };
}

function applyRecentDateSeatTrimToLeg(routes: FormattedRoute[], date: string): FormattedRoute[] {
  if (!isWithinRecentDateWindow(date)) return routes;
  return routes.map(applyRecentDateSeatTrim);
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
  // TAK-28: v4 is the only version that generates LOY (loyalty points) pricing rows.
  const { from, to, departureDate, returnDate, id, mode, outbound, inbound } = await searchFlightsBase(request, true);

  // TAK-27: apply the recent-date seat-class trim (v4 only) to each leg independently — the
  // outbound leg checks departureDate, the inbound (return) leg checks returnDate — before
  // storing/paginating, so every page of this search sees the same trimmed pricing.
  const trimmedOutbound = applyRecentDateSeatTrimToLeg(outbound, departureDate);
  const trimmedInbound = returnDate && inbound ? applyRecentDateSeatTrimToLeg(inbound, returnDate) : inbound;

  // Route/Flight instances (formatRoute's source) are only resolvable by ID for the instance
  // store TTL, same window /search/pages needs to still be able to slice a later page — so the
  // full route lists are stashed here, keyed by this search's own id, rather than re-derived.
  storeSearchResults(id, { outbound: trimmedOutbound, inbound: trimmedInbound });

  return {
    from,
    to,
    departureDate,
    returnDate,
    id,
    mode,
    outbound: trimmedOutbound.slice(0, SEARCH_PAGE_SIZE).map(toV4Route),
    outboundCurrentPage: 1,
    outboundTotalPages: totalPages(trimmedOutbound.length),
    inbound: trimmedInbound ? trimmedInbound.slice(0, SEARCH_PAGE_SIZE).map(toV4Route) : undefined,
    inboundCurrentPage: trimmedInbound ? 1 : undefined,
    inboundTotalPages: trimmedInbound ? totalPages(trimmedInbound.length) : undefined,
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
