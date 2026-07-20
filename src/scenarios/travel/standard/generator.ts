import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';
import type { Aircraft, Airline, Airport, Flight, Pricing, Route } from './types.js';
import { TravelStore } from './store.js';
import { convertFromUsd } from './currency.js';

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
  const R = 6371; // Earth radius
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.long - a.long);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// FLIGHT_GENERATOR.md Time Flow: Flight Duration. Distance is the primary input; assume a
// fixed reasonable cruise velocity and jitter each leg independently so identical-distance
// legs don't produce identical durations. Aircraft performance stays irrelevant to timing.
const CRUISE_SPEED_KMH = 800;
const DURATION_JITTER_RATIO = 0.08;
const MIN_FLIGHT_TIME_HOURS = 0.5;

function makeDurationHours(distanceKms: number): number {
  const base = Math.max(distanceKms / CRUISE_SPEED_KMH, MIN_FLIGHT_TIME_HOURS);
  const jitter = faker.number.float({ min: -DURATION_JITTER_RATIO, max: DURATION_JITTER_RATIO });
  return base * (1 + jitter);
}

// A leg counts as "regional" for aircraft/pricing purposes if either endpoint is a regional
// airport — mirrors FLIGHT_GENERATOR.md's Design section (regional airports are served by few,
// small-scale domestic airlines).
function isRegionalLeg(from: Airport, to: Airport): boolean {
  return from.isRegional || to.isRegional;
}

// FLIGHT_GENERATOR.md Equipment Generation: aircraft size follows the route's airport
// category — a regional leg (either end) is too small for anything but a small aircraft, a
// hub-to-hub leg is the only case that can justify a large aircraft, everything else (regular
// airports, regular-to-hub feeders) gets a medium aircraft.
function pickAircraftSize(from: Airport, to: Airport): Aircraft['type'] {
  if (isRegionalLeg(from, to)) return 'small';
  if (from.isHub && to.isHub) return 'large';
  return 'medium';
}

function pickAircraft(from: Airport, to: Airport, aircraft: Aircraft[]): Aircraft {
  const size = pickAircraftSize(from, to);
  return faker.helpers.arrayElement(aircraft.filter((a) => a.type === size));
}

// Flight number format: "CC XXAAXAA" — airline IATA code, space, two random letters, two
// random digits, one random letter, two random digits.
function makeFlightNumber(airlineIata: string): string {
  const suffix =
    faker.string.alpha({ length: 2, casing: 'upper' }) +
    faker.string.numeric(2) +
    faker.string.alpha({ length: 1, casing: 'upper' }) +
    faker.string.numeric(2);
  return `${airlineIata} ${suffix}`;
}

// FLIGHT_GENERATOR.md Pricing: base fare is a flat component plus a per-km rate that varies by
// leg category — regional legs (short-haul, small aircraft) carry a higher per-km rate than
// non-regional legs, reflecting worse economies of scale on short domestic hops. Always USD;
// currency conversion is a Route-level concern (see groupRoutes), not a Flight one.
const REGIONAL_PRICE_PER_KM_USD = 0.35;
const NON_REGIONAL_PRICE_PER_KM_USD = 0.12;
const BASE_FARE_USD = 25;
const REGULAR_PRICE_JITTER_RATIO = 0.1;

// Class fares are derived from the jittered Regular fare via fixed multipliers (Economy 30%
// discount, Business +180%, First +300%), each with a little independent jitter of its own so
// the ratios aren't perfectly exact across every Flight.
const ECONOMY_MULTIPLIER = 0.7;
const BUSINESS_MULTIPLIER = 1.8;
const FIRST_MULTIPLIER = 3.0;
const CLASS_MULTIPLIER_JITTER_RATIO = 0.05;

function jitter(value: number, ratio: number): number {
  return value * (1 + faker.number.float({ min: -ratio, max: ratio }));
}

function makePricing(distanceKms: number, from: Airport, to: Airport, available: number): Pricing {
  const perKm = isRegionalLeg(from, to) ? REGIONAL_PRICE_PER_KM_USD : NON_REGIONAL_PRICE_PER_KM_USD;
  const regular = Math.round(jitter(BASE_FARE_USD + distanceKms * perKm, REGULAR_PRICE_JITTER_RATIO));

  return {
    currency: 'USD',
    available,
    regular,
    economy: Math.round(regular * jitter(ECONOMY_MULTIPLIER, CLASS_MULTIPLIER_JITTER_RATIO)),
    businessClass: Math.round(regular * jitter(BUSINESS_MULTIPLIER, CLASS_MULTIPLIER_JITTER_RATIO)),
    firstClass: Math.round(regular * jitter(FIRST_MULTIPLIER, CLASS_MULTIPLIER_JITTER_RATIO)),
  };
}

// Timestamps here are placeholders (the raw query date) — applyTimeFlow overwrites them once a
// Route's departure slot is known.
function makeFlight(from: Airport, to: Airport, date: string, airline: Airline, aircraftList: Aircraft[]): Flight {
  const flightDistanceKms = haversineKm(from, to);
  const aircraft = pickAircraft(from, to, aircraftList);
  const available = faker.number.int({ min: 10, max: aircraft.capacity });
  const pricing = makePricing(flightDistanceKms, from, to, available);
  return {
    id: generateId(),
    flightTimeHours: makeDurationHours(flightDistanceKms),
    flightDistanceKms,
    departure: {
      timestamp: date,
      airport: from.iata,
    },
    arrival: {
      timestamp: date,
      airport: to.iata,
    },
    travelInfo: {
      airline: airline.iata,
      aircraft: `${aircraft.manufacturer} ${aircraft.model}`,
      flightNumber: makeFlightNumber(airline.iata),
    },
    price: pricing.regular ?? 0,
    pricing: [pricing],
    available,
  };
}

// Path Flow builds the same logical leg (departure airport + arrival airport + date +
// airline) repeatedly across different gateway/hub-path/airline-combination branches — e.g.
// every route combination that shares a route's first hub leg should point at the exact same
// Flight instance (same id, same eventual timestamps), not a freshly minted lookalike. Cache
// by (from, to, date, airline) within a single findDirectFlights/findConnectingRoutes call so
// combinatorial expansion reuses instances instead of duplicating them.
type FlightCache = Map<string, Flight>;

function flightCacheKey(from: string, to: string, date: string, airline: string): string {
  return `${from}|${to}|${date}|${airline}`;
}

function getOrMakeFlight(
  cache: FlightCache,
  from: Airport,
  to: Airport,
  date: string,
  airline: Airline,
  aircraftList: Aircraft[],
): Flight {
  const key = flightCacheKey(from.iata, to.iata, date, airline.iata);
  let flight = cache.get(key);
  if (!flight) {
    flight = makeFlight(from, to, date, airline, aircraftList);
    cache.set(key, flight);
  }
  return flight;
}

// `count` will gate how many routes are returned once multi-route/layover logic lands.
export async function findDirectFlights(from: string, to: string, date: string, _count: number = 10): Promise<Flight[]> {
  faker.seed(hashFlightQuery(from, to, date));

  // First pass: only path resolution. A direct flight is possible whenever an airline
  // holds a regional airport_airlines edge at both `from` and `to`; one Flight per airline.
  const [fromAirport, toAirport, regionalAirlines, aircraftList] = await Promise.all([
    store.getAirport(from),
    store.getAirport(to),
    store.getRegionalAirlines(from, to),
    store.getAircraft(),
  ]);
  if (!fromAirport || !toAirport) return [];

  return regionalAirlines.map((airline) => makeFlight(fromAirport, toAirport, date, airline, aircraftList));
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
  flightCache: FlightCache,
  aircraftList: Aircraft[],
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
          ? getOrMakeFlight(flightCache, airport, regular, date, airline, aircraftList)
          : getOrMakeFlight(flightCache, regular, airport, date, airline, aircraftList);

      // Recurse: the regular connector airport still needs to reach a proper Hub.
      const downstream = await reduceToHub(regular, date, direction, flightCache, aircraftList);
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
      ? getOrMakeFlight(flightCache, airport, nearest.hub, date, airline, aircraftList)
      : getOrMakeFlight(flightCache, nearest.hub, airport, date, airline, aircraftList);

  return [{ hub: nearest.hub, edges: [edge] }];
}

// Hub-to-hub edges aren't distance-bounded the way departure/arrival legs are: build-db.ts
// links a hub to any airline whose headquarters sits within MAX_HUB_RANGE_KM, so two hubs on
// opposite sides of one HQ's range circle can end up ~2x that apart; on top of that, isolated
// clusters (e.g. HNL) get one intentional long bridge edge with no distance check at all, just
// to keep the hub graph connected. Left unfiltered, BFS-by-hop-count will happily ride one of
// those as a "shortcut" and produce a single 12,000km+ leg. Prefer edges under MAX_HUB_HOP_KM;
// only fall back to the unrestricted graph if that yields no path, so bridged clusters stay
// reachable (just never picked over a shorter real alternative when one exists).
const MAX_HUB_HOP_KM = 7000;

// Hubs aren't necessarily linked pairwise — build-db.ts only guarantees every hub reaches
// every other hub via *some* sequence of shared-airline legs (see its assertHubGraphConnected).
// So "a path from starting Hub to destination Hub" can itself be multiple hub-to-hub hops;
// find the shortest one with a plain BFS over the (small, ~17-node) hub graph.
async function findHubPath(startHub: Airport, endHub: Airport, maxHopKm?: number): Promise<Airport[] | undefined> {
  if (startHub.iata === endHub.iata) return [startHub];

  const visited = new Set([startHub.iata]);
  let frontier: Airport[][] = [[startHub]];

  while (frontier.length > 0) {
    const nextFrontier: Airport[][] = [];
    for (const path of frontier) {
      const last = path[path.length - 1];
      const neighbors = await store.getReachableAirports(last.iata, { onlyHub: true });
      for (const neighbor of neighbors) {
        if (visited.has(neighbor.iata)) continue;
        if (maxHopKm !== undefined && haversineKm(last, neighbor) > maxHopKm) continue;
        const nextPath = [...path, neighbor];
        if (neighbor.iata === endHub.iata) return nextPath;
        visited.add(neighbor.iata);
        nextFrontier.push(nextPath);
      }
    }
    frontier = nextFrontier;
  }

  return undefined;
}

async function findBestHubPath(startHub: Airport, endHub: Airport): Promise<Airport[] | undefined> {
  return (await findHubPath(startHub, endHub, MAX_HUB_HOP_KM)) ?? findHubPath(startHub, endHub);
}

// Path Flow returns one Route per combination found (every start-gateway x end-gateway x
// all-hub-leg-airline combination), not a sampled subset — trimming is a later Normalization
// concern. MAX_ROUTES is a hard safety cap only; a real route explosion this large should never
// happen given the ~17-node hub graph and small per-airport gateway/airline fan-out.
const MAX_ROUTES = 1000;

// Generate cartesian product of airline combinations across all hub legs.
function* generateAirlineCombinations(legAirlines: Airline[][]): Generator<Airline[]> {
  if (legAirlines.length === 0) return;
  if (legAirlines.length === 1) {
    for (const airline of legAirlines[0]) {
      yield [airline];
    }
    return;
  }

  const [first, ...rest] = legAirlines;
  for (const airline of first) {
    for (const combination of generateAirlineCombinations(rest)) {
      yield [airline, ...combination];
    }
  }
}

// Second pass: when no direct regional flight exists, build routes via a starting Hub and
// a destination Hub per FLIGHT_GENERATOR.md Path Flow. Each returned Flight[] is one
// ordered leg-sequence for a single Route (regional→regular→hub → hub-path → hub→regular→regional,
// with degenerate cases when either end is already a Hub or regular).
export async function findConnectingRoutes(from: string, to: string, date: string): Promise<Flight[][]> {
  faker.seed(hashFlightQuery(from, to, date));

  const fromAirport = await store.getAirport(from);
  const toAirport = await store.getAirport(to);
  if (!fromAirport || !toAirport) return [];
  // Isolated airports don't receive civilian flights.
  if (fromAirport.isIsolated || toAirport.isIsolated) return [];

  const aircraftList = await store.getAircraft();
  const flightCache: FlightCache = new Map();
  const starts = await reduceToHub(fromAirport, date, 'outbound', flightCache, aircraftList);
  const ends = await reduceToHub(toAirport, date, 'inbound', flightCache, aircraftList);
  if (starts.length === 0 || ends.length === 0) return [];

  const routes: Flight[][] = [];
  for (const start of starts) {
    for (const end of ends) {
      if (start.hub.iata === end.hub.iata) {
        const seq = [...start.edges, ...end.edges];
        if (seq.length > 0) {
          routes.push(seq);
          if (routes.length >= MAX_ROUTES) return routes;
        }
        continue;
      }

      const hubPath = await findBestHubPath(start.hub, end.hub);
      if (!hubPath) continue;

      // Collect airlines for each hub-to-hub leg.
      const legAirlines: Airline[][] = [];
      for (let i = 0; i < hubPath.length - 1; i++) {
        const airlines = await store.getConnectingAirlines(hubPath[i].iata, hubPath[i + 1].iata);
        if (airlines.length === 0) {
          // No airlines serve this leg, skip this hub path entirely.
          legAirlines.length = 0;
          break;
        }
        legAirlines.push(airlines);
      }

      if (legAirlines.length === 0) continue;

      // Generate routes for every airline combination across all hub legs. Legs shared by
      // multiple combinations (e.g. the first hub leg when only a later leg's airline
      // varies) resolve to the same cached Flight instance via getOrMakeFlight.
      for (const airlineCombination of generateAirlineCombinations(legAirlines)) {
        const hubLegs: Flight[] = [];
        for (let i = 0; i < hubPath.length - 1; i++) {
          hubLegs.push(
            getOrMakeFlight(flightCache, hubPath[i], hubPath[i + 1], date, airlineCombination[i], aircraftList),
          );
        }
        routes.push([...start.edges, ...hubLegs, ...end.edges]);
        if (routes.length >= MAX_ROUTES) return routes;
      }
    }
  }

  return routes;
}

// FLIGHT_GENERATOR.md Time Flow: Connection Time. Layover length depends on whether the
// connecting airport is a Hub (long-haul-style layover) or not (short domestic-style layover).
const NON_HUB_CONNECTION_MIN_MINUTES = 30;
const NON_HUB_CONNECTION_MAX_MINUTES = 180;
const HUB_CONNECTION_MIN_HOURS = 4;
const HUB_CONNECTION_MAX_HOURS = 7;

function makeConnectionHours(connectingAirport: Airport): number {
  if (connectingAirport.isHub) {
    return faker.number.float({ min: HUB_CONNECTION_MIN_HOURS, max: HUB_CONNECTION_MAX_HOURS });
  }
  return faker.number.float({ min: NON_HUB_CONNECTION_MIN_MINUTES, max: NON_HUB_CONNECTION_MAX_MINUTES }) / 60;
}

// FLIGHT_GENERATOR.md Time Flow: Departure Windows & Availability. Floors are evaluated
// against the departure airport's local wall clock, then converted back to a UTC instant.
const CURRENT_DAY_FLOOR_HOURS = 6;
const FULL_DAY_FLOOR_HOUR = 5; // 5AM local — a floor, not a rigid slot start.

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// UTC instant of `hour`:00 local wall-clock time on `date`, at an airport with `utcOffset`.
function localHourToUtcInstant(date: string, hour: number, utcOffset: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour) - utcOffset * 3600_000;
}

// The [start, end) instant window within which this Route collection's departures may be
// spaced out, given the search `date` and the departure airport's local clock/offset.
function departureWindow(date: string, utcOffset: number, now: number): { start: number; end: number } {
  const localNow = now + utcOffset * 3600_000;
  const localNowDate = new Date(localNow);
  const today = `${localNowDate.getUTCFullYear()}-${pad(localNowDate.getUTCMonth() + 1)}-${pad(localNowDate.getUTCDate())}`;

  const fiveAm = localHourToUtcInstant(date, FULL_DAY_FLOOR_HOUR, utcOffset);
  const nextMidnight = localHourToUtcInstant(date, 24, utcOffset);

  // Future day (or a past date, which callers should already have rejected): the 5AM floor
  // is the only restriction — no other time-of-day gating applies.
  if (date !== today) {
    return { start: fiveAm, end: nextMidnight };
  }

  // Current day: earliest departure is 6 hours from now. If that pushes past this day's
  // schedule (crosses local midnight), no current-day flights are offered — roll over
  // entirely to the next day's full 5AM-floored schedule instead.
  const sixHoursFromNow = now + CURRENT_DAY_FLOOR_HOURS * 3600_000;
  if (sixHoursFromNow >= nextMidnight) {
    const nextDayFiveAm = nextMidnight + FULL_DAY_FLOOR_HOUR * 3600_000;
    return { start: nextDayFiveAm, end: nextMidnight + 24 * 3600_000 };
  }

  return { start: Math.max(fiveAm, sixHoursFromNow), end: nextMidnight };
}

function formatLocalTimestamp(utcMillis: number, utcOffset: number): string {
  const local = new Date(utcMillis + utcOffset * 3600_000);
  const offsetSign = utcOffset >= 0 ? '+' : '-';
  const offsetMagnitude = Math.abs(utcOffset);
  const offsetStr = Number.isInteger(offsetMagnitude) ? `${offsetMagnitude}` : offsetMagnitude.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} UTC${offsetSign}${offsetStr}`
  );
}

// Time Flow: takes the Route collection Path Flow already built and only spaces out each
// Route's departure time — it never adds or removes Routes (trimming is a later, Normalization
// concern). Each Route's own first-leg departure is spread evenly across the valid departure
// window for `date`; subsequent leg timestamps then follow sequentially from Flight Duration
// and Connection Time.
//
// Path Flow now hands back sequences that share Flight *instances* (same object, same id)
// wherever combinations overlap on a leg (see getOrMakeFlight) — e.g. two Routes that only
// differ on their last leg still point at the identical first N Flight objects. Timestamping
// must respect that: a shared Flight gets its departure/arrival computed exactly once (the
// first time it's reached) and every other sequence that references it reuses the result
// instead of overwriting it with a different, index-derived time. Departure-window spacing is
// therefore distributed across the distinct *first* Flight instances, not one slot per Route.
export async function applyTimeFlow(sequences: Flight[][], date: string): Promise<Flight[][]> {
  const now = Date.now();
  const airportCache = new Map<string, Airport | undefined>();
  const getAirport = async (iata: string): Promise<Airport | undefined> => {
    if (!airportCache.has(iata)) {
      airportCache.set(iata, await store.getAirport(iata));
    }
    return airportCache.get(iata);
  };

  const timestamped = new Map<Flight, { departureInstant: number; arrivalInstant: number }>();

  const rootFlights: Flight[] = [];
  const rootIndex = new Map<Flight, number>();
  for (const sequence of sequences) {
    if (sequence.length === 0) continue;
    const root = sequence[0];
    if (!rootIndex.has(root)) {
      rootIndex.set(root, rootFlights.length);
      rootFlights.push(root);
    }
  }

  for (const sequence of sequences) {
    if (sequence.length === 0) continue;

    const rootFlight = sequence[0];
    const alreadyRooted = timestamped.get(rootFlight);
    let cursor: number;

    if (alreadyRooted) {
      cursor = alreadyRooted.departureInstant;
    } else {
      const departureAirport = await getAirport(rootFlight.departure.airport);
      if (!departureAirport) continue;

      const window = departureWindow(date, departureAirport.utcOffset, now);
      const spacing = (window.end - window.start) / rootFlights.length;
      cursor = window.start + rootIndex.get(rootFlight)! * spacing;
    }

    for (let i = 0; i < sequence.length; i++) {
      const flight = sequence[i];
      const existing = timestamped.get(flight);

      if (existing) {
        cursor = existing.arrivalInstant;
        continue;
      }

      const fromAirport = await getAirport(flight.departure.airport);
      const toAirport = await getAirport(flight.arrival.airport);
      if (!fromAirport || !toAirport) continue;

      const departureInstant = cursor;
      const arrivalInstant = departureInstant + flight.flightTimeHours * 3600_000;

      flight.departure.timestamp = formatLocalTimestamp(departureInstant, fromAirport.utcOffset);
      flight.arrival.timestamp = formatLocalTimestamp(arrivalInstant, toAirport.utcOffset);
      timestamped.set(flight, { departureInstant, arrivalInstant });

      cursor = arrivalInstant;
      if (i < sequence.length - 1) {
        cursor += makeConnectionHours(toAirport) * 3600_000;
      }
    }
  }

  return sequences;
}

type PriceClassKey = 'regular' | 'economy' | 'businessClass' | 'firstClass';
const PRICE_CLASS_KEYS: PriceClassKey[] = ['regular', 'economy', 'businessClass', 'firstClass'];

// Route pricing sums each seat class across every leg's USD pricing (a leg missing a class,
// e.g. no first class offered, just doesn't contribute to that class's sum).
function sumFlightPricing(flights: Flight[]): Pricing {
  const sum = (key: PriceClassKey): number | undefined =>
    flights.reduce<number | undefined>((acc, f) => {
      const value = f.pricing[0]?.[key];
      return value === undefined ? acc : (acc ?? 0) + value;
    }, undefined);

  const summed: Pricing = { currency: 'USD', available: Math.min(...flights.map((f) => f.available)) };
  for (const key of PRICE_CLASS_KEYS) {
    summed[key] = sum(key);
  }
  return summed;
}

// Converts a summed-USD Pricing entry into another currency, or undefined if that currency
// has no known exchange rate (currency.ts).
function convertPricing(pricing: Pricing, currency: string): Pricing | undefined {
  const converted: Pricing = { currency, available: pricing.available };
  for (const key of PRICE_CLASS_KEYS) {
    const usdValue = pricing[key];
    if (usdValue === undefined) continue;
    const value = convertFromUsd(usdValue, currency);
    if (value === undefined) return undefined; // currency not in the reference table
    converted[key] = value;
  }
  return converted;
}

// Wrap ordered flight sequences into Routes. Route metadata (time, distance, availability) is
// aggregated across the sequence — the Normalization step in FLIGHT_GENERATOR.md. Route
// pricing is the sum of each leg's USD pricing per seat class, plus (per FLIGHT_GENERATOR.md
// Pricing) a second Pricing entry converted to the departure airport's local currency — an
// alternate-currency view that only ever appears on the Route, never on individual Flights.
export async function groupRoutes(sequences: Flight[][]): Promise<Route[]> {
  const localCurrencyCache = new Map<string, string | undefined>();
  const getLocalCurrency = async (iata: string): Promise<string | undefined> => {
    if (!localCurrencyCache.has(iata)) {
      const airport = await store.getAirport(iata);
      localCurrencyCache.set(iata, airport?.localCurrency);
    }
    return localCurrencyCache.get(iata);
  };

  const routes: Route[] = [];
  for (const seq of sequences) {
    const first = seq[0];
    const last = seq[seq.length - 1];
    const usdPricing = sumFlightPricing(seq);
    const pricing: Pricing[] = [usdPricing];

    const localCurrency = await getLocalCurrency(first.departure.airport);
    if (localCurrency && localCurrency !== 'USD') {
      const converted = convertPricing(usdPricing, localCurrency);
      if (converted) pricing.push(converted);
    }

    routes.push({
      id: generateId(),
      flightTimeHours: seq.reduce((sum, f) => sum + f.flightTimeHours, 0),
      flightDistanceKms: seq.reduce((sum, f) => sum + f.flightDistanceKms, 0),
      departure: first.departure,
      arrival: last.arrival,
      flights: seq,
      available: usdPricing.available,
      price: usdPricing.regular ?? 0,
      pricing,
    });
  }

  return routes;
}
