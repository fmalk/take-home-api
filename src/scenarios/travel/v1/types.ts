import type { Airport, Airline, Flight } from '../standard/types.js';

// v1 response shapes: trimmed versions of the shared travel types.
// Composed from the base types so a v1 field drop can never silently
// diverge from the canonical shape in travel/standard/types.ts.
export type V1Airport = Omit<Airport, 'icao' | 'utcOffset' | 'lat' | 'long' | 'isStandard' | 'isRegional' | 'isHub' | 'isIsolated'>;
export type V1Airline = Omit<Airline, 'icao' | 'hasEconomyClass' | 'hasBusinessClass' | 'hasFirstClass' | 'hasLoyaltyProgram'>;
export type V1Flight = Omit<Flight, 'seats' | 'pricing'> // TODO: omit seats and price, but use "price" as flat number