import type { Airport, Airline, Pricing, Seats } from '../standard/index.js';

// v1 response shapes: trimmed versions of the shared travel types.
// Composed from the base types so a v1 field drop can never silently
// diverge from the canonical shape in travel/types/index.ts.
export type V1Airport = Omit<Airport, 'icao' | 'utcOffset'>;
export type V1Airline = Omit<Airline, 'icao'>;
export type V1Pricing = Omit<Pricing, 'economy' | 'businessClass' | 'firstClass'>;
export type V1Seats = Omit<Seats, 'economy' | 'businessClass' | 'firstClass'>;
