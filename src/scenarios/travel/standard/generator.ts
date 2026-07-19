import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';
import type { Airline, Airport, Flight, Route } from './types.js';
import { TravelStore } from './store.js';

const store = new TravelStore();

// Keep this, useful for Faker
function hashFlightQuery(from: string, to: string, date: string): number {
  const str = `${from}|${to}|${date}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function generateId(): string {
  return randomUUID();
}

function haversineKm(a: { lat: number; long: number }, b: { lat: number; long: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.long - a.long);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Stub edge factory. Time/distance/pricing/seat enrichment happens in later Search-Flow
// stages that are still `To be determined` in FLIGHT_GENERATOR.md.
function makeFlight(fromIata: string, toIata: string, date: string, airline: Airline): Flight {
  return {
    id: generateId(),
    flightTimeHours: 1,
    flightDistanceKms: 100,
    departure: {
      timestamp: date,
      airport: fromIata,
    },
    arrival: {
      timestamp: date,
      airport: toIata,
    },
    travelInfo: {
      airline: airline.iata,
      plane: '',
      flightNumber: '',
    },
    price: 0,
    pricing: [{ currency: 'USD', regular: 0 }],
    available: 0,
    seats: [{ regular: 0 }],
  };
}

// `count` will gate how many routes are returned once multi-route/layover logic lands.
export async function findDirectFlights(from: string, to: string, date: string, _count: number = 10): Promise<Flight[]> {
  faker.seed(hashFlightQuery(from, to, date));

  // First pass: only path resolution. A direct flight is possible whenever an airline
  // holds a regional airport_airlines edge at both `from` and `to`; one Flight per airline.
  const regionalAirlines = await store.getRegionalAirlines(from, to);

  return regionalAirlines.map((airline) => makeFlight(from, to, date, airline));
}

// Departure reduction: given the query's departure or arrival airport, produce candidate
// (hub, connector-edges) pairs that feed the hub-to-hub search. `direction` controls which
// way each connector edge points — outbound edges go airport→hub, inbound edges go
// hub→airport, so the caller can splice both onto either side of the middle hub-to-hub leg.
type GatewayCandidate = { hub: Airport; edges: Flight[] };

async function reduceToHub(
  airport: Airport,
  date: string,
  direction: 'outbound' | 'inbound',
): Promise<GatewayCandidate[]> {
  if (airport.isHub) {
    return [{ hub: airport, edges: [] }];
  }

  if (airport.isRegional) {
    // Regional → one (primary) and one (secondary) close regular airport via regional flights.
    const reachable = await store.getReachableAirports(airport.iata, { onlyRegular: true, regionalFrom: true });
    const nearestRegulars = reachable
      .map((a) => ({ airport: a, distance: haversineKm(airport, a) }))
      .sort((x, y) => x.distance - y.distance)
      .slice(0, 2);

    const results: GatewayCandidate[] = [];
    for (const { airport: regular } of nearestRegulars) {
      const airlines = await store.getConnectingAirlines(airport.iata, regular.iata, {
        regionalFrom: true,
        regionalTo: true,
      });
      if (airlines.length === 0) continue;
      const airline = faker.helpers.arrayElement(airlines);
      const connector =
        direction === 'outbound'
          ? makeFlight(airport.iata, regular.iata, date, airline)
          : makeFlight(regular.iata, airport.iata, date, airline);

      // Recurse: the regular connector airport still needs to reach a proper Hub.
      const downstream = await reduceToHub(regular, date, direction);
      for (const gw of downstream) {
        results.push({
          hub: gw.hub,
          edges: direction === 'outbound' ? [connector, ...gw.edges] : [...gw.edges, connector],
        });
      }
    }
    return results;
  }

  // Standard/regular airport → its closest Hub, connected by whichever airline serves both.
  const hubs = await store.getHubs();
  const nearest = hubs
    .filter((h) => h.iata !== airport.iata)
    .map((h) => ({ hub: h, distance: haversineKm(airport, h) }))
    .sort((x, y) => x.distance - y.distance)[0];
  if (!nearest) return [];

  const airlines = await store.getConnectingAirlines(airport.iata, nearest.hub.iata);
  if (airlines.length === 0) return [];
  const airline = faker.helpers.arrayElement(airlines);
  const edge =
    direction === 'outbound'
      ? makeFlight(airport.iata, nearest.hub.iata, date, airline)
      : makeFlight(nearest.hub.iata, airport.iata, date, airline);

  return [{ hub: nearest.hub, edges: [edge] }];
}

// Second pass: when no direct regional flight exists, build routes via a starting Hub and
// a destination Hub per FLIGHT_GENERATOR.md Path Flow. Each returned Flight[] is one
// ordered leg-sequence for a single Route (regional→regular→hub → hub→regular→regional,
// with degenerate cases when either end is already a Hub or regular).
export async function findConnectingRoutes(from: string, to: string, date: string, count: number = 3): Promise<Flight[][]> {
  faker.seed(hashFlightQuery(from, to, date));

  const fromAirport = await store.getAirport(from);
  const toAirport = await store.getAirport(to);
  if (!fromAirport || !toAirport) return [];
  // Isolated airports don't receive civilian flights.
  if (fromAirport.isIsolated || toAirport.isIsolated) return [];

  const starts = await reduceToHub(fromAirport, date, 'outbound');
  const ends = await reduceToHub(toAirport, date, 'inbound');
  if (starts.length === 0 || ends.length === 0) return [];

  const routes: Flight[][] = [];
  for (const start of starts) {
    for (const end of ends) {
      if (start.hub.iata === end.hub.iata) {
        const seq = [...start.edges, ...end.edges];
        if (seq.length > 0) {
          routes.push(seq);
          if (routes.length >= count) return routes;
        }
        continue;
      }

      const hubAirlines = await store.getConnectingAirlines(start.hub.iata, end.hub.iata);
      const shuffled = faker.helpers.shuffle(hubAirlines);
      for (const airline of shuffled.slice(0, count)) {
        const hubLeg = makeFlight(start.hub.iata, end.hub.iata, date, airline);
        routes.push([...start.edges, hubLeg, ...end.edges]);
        if (routes.length >= count) return routes;
      }
    }
  }

  return routes;
}

// Wrap ordered flight sequences into Routes. Route metadata (time, distance, price,
// availability) is aggregated across the sequence — the Normalization step in
// FLIGHT_GENERATOR.md. Pricing is still stubbed pending the TBD Pricing stage.
export function groupRoutes(sequences: Flight[][]): Route[] {
  return sequences.map((seq) => {
    const first = seq[0];
    const last = seq[seq.length - 1];
    return {
      id: generateId(),
      flightTimeHours: seq.reduce((sum, f) => sum + f.flightTimeHours, 0),
      flightDistanceKms: seq.reduce((sum, f) => sum + f.flightDistanceKms, 0),
      departure: first.departure,
      arrival: last.arrival,
      flights: seq,
      available: Math.min(...seq.map((f) => f.available)),
      price: seq.reduce((sum, f) => sum + f.price, 0),
      pricing: first.pricing,
    };
  });
}
