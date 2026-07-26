import { cacheKey, getCached, setCached } from '../../../core/cache.js';
import type { Flight, Route } from './types.js';
import type { FormattedRoute } from './formatters.js';

// Generated Flights/Routes are transient instances (per FLIGHT_GENERATOR_MD's "generated
// on-the-fly per request" philosophy), not persisted rows — but downstream stages (seat
// selection, pricing, booking) need to resolve one by its ID without re-deriving the whole
// search. This is a lookup store, not a perf cache, backed by the same always-on cache.
const NAMESPACE = 'travel:instances';
const INSTANCE_TTL_SECONDS = 300;

export function storeFlights(flights: Flight[]): void {
  for (const flight of flights) {
    setCached(cacheKey(NAMESPACE, 'flight', flight.id), flight, INSTANCE_TTL_SECONDS);
  }
}

export function storeRoutes(routes: Route[]): void {
  for (const route of routes) {
    setCached(cacheKey(NAMESPACE, 'route', route.id), route, INSTANCE_TTL_SECONDS);
    storeFlights(route.flights);
  }
}

export function getStoredFlight(id: string): Flight | undefined {
  return getCached<Flight>(cacheKey(NAMESPACE, 'flight', id));
}

export function getStoredRoute(id: string): Route | undefined {
  return getCached<Route>(cacheKey(NAMESPACE, 'route', id));
}

// Full (unpaginated) formatted outbound/inbound route lists for a search, keyed by the search's
// own `id` (distinct from the per-route `id` above) — lets a paginated endpoint (v4's
// /search/pages) slice out any page without re-running the search pipeline or re-formatting.
// Same TTL/store as individual routes, since a page is only ever walkable while its routes are
// still resolvable by ID.
export interface StoredSearchResults {
  outbound: FormattedRoute[];
  inbound?: FormattedRoute[];
}

export function storeSearchResults(id: string, results: StoredSearchResults): void {
  setCached(cacheKey(NAMESPACE, 'search', id), results, INSTANCE_TTL_SECONDS);
}

export function getStoredSearchResults(id: string): StoredSearchResults | undefined {
  return getCached<StoredSearchResults>(cacheKey(NAMESPACE, 'search', id));
}
