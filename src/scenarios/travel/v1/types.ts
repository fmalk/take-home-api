import type { Airport, Airline, Flight, Route } from '../standard/types.js';

// v1 response shapes: trimmed versions of the shared travel types.
// Composed from the base types so a v1 field drop can never silently
// diverge from the canonical shape in travel/standard/types.ts.
export type V1Airport = Omit<
  Airport,
  'icao' | 'utcOffset' | 'lat' | 'long' | 'isStandard' | 'isRegional' | 'isHub' | 'isIsolated'
>;
export type V1Airline = Omit<
  Airline,
  'icao' | 'hasRegularClass' | 'hasEconomyClass' | 'hasBusinessClass' | 'hasFirstClass' | 'hasLoyaltyProgram'
>;
// Drops the class-broken-out shapes, keeping only the flat `price`/`available` fields.
// Formats flightTimeHours as HH:MM string and flightDistanceKms as integer.
export type V1Flight = Omit<Flight, 'seats' | 'pricing' | 'flightTimeHours' | 'flightDistanceKms'> & {
  flightTimeHours: string;
  flightDistanceKms: number;
};
export type V1Route = Omit<Route, 'flights' | 'pricing' | 'flightTimeHours' | 'flightDistanceKms'> & {
  flightTimeHours: string;
  flightDistanceKms: number;
  flights: V1Flight[];
};
