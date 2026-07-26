import type { Airport, Airline } from '../standard/types.js';
import type { FormattedFlight, FormattedRoute } from '../standard/formatters.js';

// v4 response shapes: same full-surface base as v3 (composed from the shared base
// types/formatters so a field drop can never silently diverge from the canonical shape), still
// keeping every seat class (regular/economy/businessClass/firstClass) in `pricing`.
export type V4Airport = Omit<Airport, 'isStandard' | 'isRegional' | 'isHub' | 'isIsolated'>;
export type V4Airline = Airline;
// Drops the flat `price` simplification, keeping the full per-class `pricing` breakdown.
export type V4Flight = Omit<FormattedFlight, 'price'>;
export type V4Route = Omit<FormattedRoute, 'flights' | 'price'> & {
  flights: V4Flight[];
};

// A single seat choice on the purchase request: identifies which flight the choice is for and
// which seat class was picked, plus the currency/price the client saw when choosing (so the
// server can validate it still matches the stored flight's current pricing for that currency).
export type SeatClass = 'regular' | 'economy' | 'businessClass' | 'firstClass';

export interface FlightSeatSelection {
  flightId: string;
  seatClass: SeatClass;
  currency: string;
  price: number;
}

// v4 search results are paginated at PAGE_SIZE routes per leg (see v4/controller.ts); the search
// response only ever carries the first page, plus enough metadata (current/total pages, per leg)
// for a client to walk the rest via GET /search/pages.
export const SEARCH_PAGE_SIZE = 15;

export interface SearchPagesQuery {
  id: string;
  outboundPage?: string;
  inboundPage?: string;
}
