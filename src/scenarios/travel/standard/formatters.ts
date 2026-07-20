import type { Flight, Route } from './types.js';
import type { V1Flight, V1Route } from '../v1/types.js';

export function formatFlightTime(hours: number): string {
  const minutes = Math.ceil(hours * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function formatFlight(flight: Flight): V1Flight {
  return {
    ...flight,
    flightTimeHours: formatFlightTime(flight.flightTimeHours),
    flightDistanceKms: Math.round(flight.flightDistanceKms),
  };
}

export function formatRoute(route: Route): V1Route {
  return {
    ...route,
    flightTimeHours: formatFlightTime(route.flightTimeHours),
    flightDistanceKms: Math.round(route.flightDistanceKms),
    flights: route.flights.map(formatFlight),
  };
}
