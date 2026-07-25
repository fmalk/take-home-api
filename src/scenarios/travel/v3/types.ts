import type { Airport, Airline, FlightPricing } from '../standard/types.js';
import type { FormattedFlight, FormattedRoute } from '../standard/formatters.js';

// v3 response shapes: same full-surface base as v2 (composed from the shared base
// types/formatters so a field drop can never silently diverge from the canonical shape), but
// unlike v2 it keeps every seat class (regular/economy/businessClass/firstClass) in `pricing`
// instead of filtering down to `regular` only — see v3/controller.ts's toV3Flight.
export type V3Airport = Omit<Airport, 'isStandard' | 'isRegional' | 'isHub' | 'isIsolated'>;
export type V3Airline = Airline;
// Drops the flat `price` simplification, keeping the full per-class `pricing` breakdown.
export type V3Flight = Omit<FormattedFlight, 'price'>;
export type V3Route = Omit<FormattedRoute, 'flights' | 'price'> & {
  flights: V3Flight[];
};

// A single seat choice on the purchase request: identifies which flight the choice is for and
// which seat class was picked, plus the FlightPricing the client saw when choosing (so the
// server can validate it still matches the stored flight's current pricing for that currency).
export type SeatClass = 'regular' | 'economy' | 'businessClass' | 'firstClass';

export interface FlightSeatSelection {
  flightId: string;
  seatClass: SeatClass;
  pricing: FlightPricing;
}
