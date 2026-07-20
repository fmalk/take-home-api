import { getCache, cacheKey } from '../../../core/cache.js';
import type { Flight, Route } from './types.js';

// Generated Flights/Routes are transient instances (per FLIGHT_GENERATOR_MD's "generated
// on-the-fly per request" philosophy), not persisted rows — but downstream stages (seat
// selection, pricing, booking) need to resolve one by its ID without re-deriving the whole
// search. This is a lookup store, not a perf cache, so it bypasses the NO_CACHE dev flag
// (core/cache.ts) by talking to the underlying NodeCache directly.
const NAMESPACE = 'travel:instances';
const INSTANCE_TTL_SECONDS = 300;

export function storeFlights(flights: Flight[]): void {
  const cache = getCache();
  for (const flight of flights) {
    cache.set(cacheKey(NAMESPACE, 'flight', flight.id), flight, INSTANCE_TTL_SECONDS);
  }
}

export function storeRoutes(routes: Route[]): void {
  const cache = getCache();
  for (const route of routes) {
    cache.set(cacheKey(NAMESPACE, 'route', route.id), route, INSTANCE_TTL_SECONDS);
    storeFlights(route.flights);
  }
}

export function getStoredFlight(id: string): Flight | undefined {
  return getCache().get<Flight>(cacheKey(NAMESPACE, 'flight', id));
}

export function getStoredRoute(id: string): Route | undefined {
  return getCache().get<Route>(cacheKey(NAMESPACE, 'route', id));
}
