import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';
import type { Aircraft, Airline, Airport, Flight, FlightPricing, RoutePricing, Route } from './types.js';
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
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.long - a.long);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
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

// FLIGHT_GENERATOR.md Equipment Generation: aircraft size follows the route's airport
// category — a regional leg (either end) is too small for anything but a small aircraft, a
// hub-to-hub leg is the only case that can justify a large aircraft, everything else (regular
// airports, regular-to-hub feeders) gets a medium aircraft.
function pickAircraftSize(from: Airport, to: Airport): Aircraft['hull'] {
  if (from.isRegional || to.isRegional) return 'small';
  if (from.isHub && to.isHub) return 'large';
  return 'medium';
}

function pickAircraft(from: Airport, to: Airport, aircraft: Aircraft[]): Aircraft {
  const size = pickAircraftSize(from, to);
  return faker.helpers.arrayElement(aircraft.filter((a) => a.hull === size));
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

// One seat class per FlightPricing object — mutually exclusive by design (see FlightPricing
// type). Which classes an airline sells is driven entirely by its regular/economy/business/first
// flags (see pickSeatClasses) — including premium-only carriers with no regular flag.
type SeatClass = 'regular' | 'economy' | 'businessClass' | 'firstClass';

// Premium classes cost more per km, economy undercuts regular; see classBasePriceUsd below.
const SEAT_CLASS_PRICE_MULTIPLIER: Record<SeatClass, number> = {
  regular: 1,
  economy: 0.7,
  businessClass: 2.5,
  firstClass: 4.5,
};

// `regular` is offered whenever an airline is flagged for it, alongside whichever premium tiers
// it's flagged for — a premium-only carrier (no regular flag) sells just business/first.
function pickSeatClasses(airline: Airline): SeatClass[] {
  if (airline.hasEconomyClass) return ['regular', 'economy'];

  const classes: SeatClass[] = [];
  if (airline.hasRegularClass) classes.push('regular');
  if (airline.hasBusinessClass) classes.push('businessClass');
  if (airline.hasFirstClass) classes.push('firstClass');
  return classes;
}

const BASE_PRICE_PER_KM_USD = 0.12;
const MIN_BASE_PRICE_USD = 35;
const PRICE_JITTER_RATIO = 0.15;

// Dynamic pricing per FLIGHT_GENERATOR.md's Pricing stage: distance-driven base fare, scaled by
// cabin class, jittered per class so identical-distance legs don't produce identical fares.
function classBasePriceUsd(distanceKms: number, seatClass: SeatClass): number {
  const base = Math.max(distanceKms * BASE_PRICE_PER_KM_USD, MIN_BASE_PRICE_USD);
  const jitter = faker.number.float({ min: -PRICE_JITTER_RATIO, max: PRICE_JITTER_RATIO });
  return Math.round(base * SEAT_CLASS_PRICE_MULTIPLIER[seatClass] * (1 + jitter) * 100) / 100;
}

// One FlightPricing object per (seat class × currency) combination — never more than one class
// field set per object (TRAVEL.md "Alternative currencies" / seat-class edge cases). Currencies
// offered are USD (universal) plus the departure airport's local currency, if different.
// Every class is offered against the flight's full `available` seat count for now — classes
// aren't cabins carved out of one shared pool yet; that weighting is a later Normalization step.
async function makePricing(
  distanceKms: number,
  available: number,
  airline: Airline,
  from: Airport,
): Promise<FlightPricing[]> {
  const classes = pickSeatClasses(airline);
  const currencies = Array.from(new Set(['USD', from.localCurrency]));

  const pricing: FlightPricing[] = [];
  for (const seatClass of classes) {
    const priceUsd = classBasePriceUsd(distanceKms, seatClass);
    for (const currency of currencies) {
      pricing.push({
        currency,
        available,
        [seatClass]: await convertFromUsd(priceUsd, currency),
      });
    }
  }
  return pricing;
}

// v1's flat `price` simplification: the USD price of the flight's base-tier class (regular, or
// economy if the airline segments cabins), falling back down the tier order if that's missing.
const PRICE_TIER_ORDER: SeatClass[] = ['regular', 'economy', 'businessClass', 'firstClass'];

function derivePrice(pricing: FlightPricing[]): number {
  for (const seatClass of PRICE_TIER_ORDER) {
    const match = pricing.find((p) => p.currency === 'USD' && p[seatClass] !== undefined);
    if (match) return match[seatClass] as number;
  }
  return 0;
}

// Timestamps here are placeholders (the raw query date) — applyTimeFlow overwrites them once a
// Route's departure slot is known.
async function makeFlight(
  from: Airport,
  to: Airport,
  date: string,
  airline: Airline,
  aircraftList: Aircraft[],
): Promise<Flight> {
  const flightDistanceKms = haversineKm(from, to);
  const aircraft = pickAircraft(from, to, aircraftList);
  const available = faker.number.int({ min: 10, max: aircraft.capacity });
  const pricing = await makePricing(flightDistanceKms, available, airline, from);
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
    price: derivePrice(pricing),
    pricing,
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

async function getOrMakeFlight(
  cache: FlightCache,
  from: Airport,
  to: Airport,
  date: string,
  airline: Airline,
  aircraftList: Aircraft[],
): Promise<Flight> {
  const key = flightCacheKey(from.iata, to.iata, date, airline.iata);
  let flight = cache.get(key);
  if (!flight) {
    flight = await makeFlight(from, to, date, airline, aircraftList);
    cache.set(key, flight);
  }
  return flight;
}

// A regional edge only ever represents a domestic or hub-feeder short-hop (build-db.ts Stages
// 1/3) — never a deliberate point-to-point link between the two specific airports being
// queried. Two airports can each separately hold a regional=1 edge for the same airline (e.g.
// TP domestically at its LIS hub, and TP again at some unrelated airport near a different hub
// it happens to reach) without that airline ever flying between the two directly. Cap "direct"
// eligibility at the same short-hop range build-db.ts already treats as plausible for a regional
// connection, so those two unrelated edges can't compose into an implausible long-haul "direct".
const MAX_DIRECT_REGIONAL_KM = 3500;

// `count` will gate how many routes are returned once multi-route/layover logic lands.
export async function findDirectFlights(
  from: string,
  to: string,
  date: string,
  _count: number = 10,
): Promise<Flight[]> {
  faker.seed(hashFlightQuery(from, to, date));

  const [fromAirport, toAirport, aircraftList] = await Promise.all([
    store.getAirport(from),
    store.getAirport(to),
    store.getAircraft(),
  ]);
  if (!fromAirport || !toAirport) return [];
  if (haversineKm(fromAirport, toAirport) > MAX_DIRECT_REGIONAL_KM) return [];

  // A direct flight is possible whenever an airline holds a regional airport_airlines edge at
  // both `from` and `to`; one Flight per airline.
  const regionalAirlines = await store.getRegionalAirlines(from, to);

  return Promise.all(
    regionalAirlines.map((airline) => makeFlight(fromAirport, toAirport, date, airline, aircraftList)),
  );
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
          ? await getOrMakeFlight(flightCache, airport, regular, date, airline, aircraftList)
          : await getOrMakeFlight(flightCache, regular, airport, date, airline, aircraftList);

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
      ? await getOrMakeFlight(flightCache, airport, nearest.hub, date, airline, aircraftList)
      : await getOrMakeFlight(flightCache, nearest.hub, airport, date, airline, aircraftList);

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
            await getOrMakeFlight(flightCache, hubPath[i], hubPath[i + 1], date, airlineCombination[i], aircraftList),
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

// Shared by applyTimeFlow and applyAirlineWeighting — both need repeated Airport lookups
// (by IATA) for the same handful of airports across many legs.
function makeAirportLookup(): (iata: string) => Promise<Airport | undefined> {
  const cache = new Map<string, Airport | undefined>();
  return async (iata: string): Promise<Airport | undefined> => {
    if (!cache.has(iata)) {
      cache.set(iata, await store.getAirport(iata));
    }
    return cache.get(iata);
  };
}

function formatLocalTimestamp(utcMillis: number, utcOffset: number): string {
  const local = new Date(utcMillis + utcOffset * 3600_000);
  const offsetSign = utcOffset >= 0 ? '+' : '-';
  const offsetMagnitude = Math.abs(utcOffset);
  const offsetStr = Number.isInteger(offsetMagnitude)
    ? `${offsetMagnitude}`
    : offsetMagnitude.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

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
  const getAirport = makeAirportLookup();

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

function edgeKey(leg: Flight): string {
  return `${leg.departure.airport}|${leg.arrival.airport}`;
}

// Only hub-to-hub legs are weighted — connector legs (regional or standard→hub) are left
// untouched entirely, their airline pool is already small (see reduceToHub).
async function isHubToHubLeg(
  leg: Flight,
  getAirport: (iata: string) => Promise<Airport | undefined>,
): Promise<boolean> {
  const [from, to] = await Promise.all([getAirport(leg.departure.airport), getAirport(leg.arrival.airport)]);
  return Boolean(from?.isHub && to?.isHub);
}

function isPremium(airline: Airline | undefined): boolean {
  return Boolean(airline?.hasFirstClass || airline?.hasBusinessClass);
}

// Premium-only carriers (no regular/economy tier at all — see pickSeatClasses) are rare and
// educational by design (e.g. NV/B0's fixed-hub exemption in build-db.ts) — this trim must never
// be the reason one goes missing from a hub-to-hub edge it's actually on. Distinct from
// isPremium: a mixed carrier like TP sells regular seats too and doesn't need this guarantee,
// only ones that sell nothing but premium do.
function isPremiumOnly(airline: Airline | undefined): boolean {
  return Boolean(airline && !airline.hasEconomyClass && !airline.hasRegularClass && isPremium(airline));
}

// Trimming is decided independently per hub-to-hub edge (one from→to pair), never across the
// whole route collection — this is what keeps a long multi-hop route viable: each of its legs
// gets its own survivor budget instead of every leg competing for one shared, collection-wide
// cap (which could empty out a route with many legs even though each individual leg still had
// plenty of options).
const HUB_EDGE_TRIM_THRESHOLD = 5;
const HUB_EDGE_KEEP_TOP = 3;
const HUB_EDGE_KEEP_BOTTOM = 3;

// Per hub-to-hub edge with more than HUB_EDGE_TRIM_THRESHOLD distinct airlines, keep only the
// top 3 by route-representation and the bottom 3 (a few dominant carriers, a few long-tail ones —
// deliberately not a smooth middle) — always at least 6 survivors when trimming happens at all,
// so a leg is never emptied out. Two retention passes run after that cut: (1) if none of the 6
// kept airlines offers a premium cabin (first or business) but the edge has one available among
// the ones just cut, it's added back in as a 7th survivor, so premium options aren't accidentally
// erased entirely; (2) every premium-only carrier (see isPremiumOnly) present on the edge is
// added back in regardless of whether it made the top/bottom cut or pass (1)'s reprieve — unlike
// a merely premium but mixed-cabin carrier, these are rare/educational by design and this stage
// must never be the reason one disappears. (A later stage, applyNormalization's presented-size
// cap, can still legitimately drop one — that's fine, this guarantee is scoped to this trim only.)
// Edges at or under the threshold are left untouched. Any Route with a leg that lost its airline
// on this pass is dropped.
export async function applyAirlineWeighting(sequences: Flight[][]): Promise<Flight[][]> {
  if (sequences.length === 0) return sequences;

  const getAirport = makeAirportLookup();
  const airlineByIata = new Map((await store.getAllAirlines()).map((a) => [a.iata, a]));

  const edgeAirlineCounts = new Map<string, Map<string, number>>();
  for (const sequence of sequences) {
    for (const leg of sequence) {
      if (!(await isHubToHubLeg(leg, getAirport))) continue;
      const key = edgeKey(leg);
      const counts = edgeAirlineCounts.get(key) ?? new Map<string, number>();
      counts.set(leg.travelInfo.airline, (counts.get(leg.travelInfo.airline) ?? 0) + 1);
      edgeAirlineCounts.set(key, counts);
    }
  }
  if (edgeAirlineCounts.size === 0) return sequences;

  const survivorsPerEdge = new Map<string, Set<string>>();
  for (const [key, counts] of edgeAirlineCounts) {
    const airlines = [...counts.keys()];
    if (airlines.length <= HUB_EDGE_TRIM_THRESHOLD) {
      survivorsPerEdge.set(key, new Set(airlines));
      continue;
    }

    const sortedDesc = faker.helpers.shuffle(airlines).sort((a, b) => counts.get(b)! - counts.get(a)!);
    const survivors = new Set([...sortedDesc.slice(0, HUB_EDGE_KEEP_TOP), ...sortedDesc.slice(-HUB_EDGE_KEEP_BOTTOM)]);

    if (![...survivors].some((iata) => isPremium(airlineByIata.get(iata)))) {
      const premiumCandidate = sortedDesc.find((iata) => isPremium(airlineByIata.get(iata)));
      if (premiumCandidate) survivors.add(premiumCandidate);
    }

    for (const iata of airlines) {
      if (isPremiumOnly(airlineByIata.get(iata))) survivors.add(iata);
    }

    survivorsPerEdge.set(key, survivors);
  }

  return sequences.filter((sequence) =>
    sequence.every((leg) => {
      const survivors = survivorsPerEdge.get(edgeKey(leg));
      return !survivors || survivors.has(leg.travelInfo.airline);
    }),
  );
}

// FLIGHT_GENERATOR.md Normalization: Route Collection Trimming. MAX_ROUTES (Path Flow) is only
// a hard safety cap on generation, not a realistic result-set size. Sampled uniformly at random
// rather than by any ranking, so surviving departures (already spread out by Time Flow) keep an
// uneven scatter across the window as a side effect, instead of the artificial clustering a
// "keep the first/earliest N" trim would produce.
const MAX_PRESENTED_ROUTES = 50;

function trimToPresentedLimit(sequences: Flight[][]): Flight[][] {
  if (sequences.length <= MAX_PRESENTED_ROUTES) return sequences;
  return faker.helpers.shuffle(sequences).slice(0, MAX_PRESENTED_ROUTES);
}

// Normalization entry point, run on the Time Flow output before groupRoutes: weight airline
// distribution (a no-op when the collection has no hub-to-hub legs at all, e.g. direct-regional
// route sets — see applyAirlineWeighting), then trim to a presentable collection size.
export async function applyNormalization(sequences: Flight[][]): Promise<Flight[][]> {
  const weighted = await applyAirlineWeighting(sequences);
  return trimToPresentedLimit(weighted);
}

// Route-level pricing collapses each leg's cheapest fare — regular or economy, premium cabins
// excluded — into a single per-currency RoutePricing `minimum`, summed across legs. Booking a
// Route always means booking each leg separately, and legs can differ in which classes they
// sell, so "the route's price" can only ever be the cheapest bookable combination, not a
// specific class carried end-to-end.
const MINIMUM_CLASS_ORDER: SeatClass[] = ['regular', 'economy'];

function legMinimumPriceByCurrency(leg: Flight): Map<string, number> {
  const minimums = new Map<string, number>();
  for (const entry of leg.pricing) {
    const seatClass = MINIMUM_CLASS_ORDER.find((c) => entry[c] !== undefined);
    if (!seatClass) continue;

    const price = entry[seatClass] as number;
    const current = minimums.get(entry.currency);
    if (current === undefined || price < current) minimums.set(entry.currency, price);
  }
  return minimums;
}

// Only currencies present on every leg are included — same rule as `available`: a leg that
// can't sell in a currency blocks it for the whole route.
function aggregateRouteMinimumPricing(sequence: Flight[]): RoutePricing[] {
  if (sequence.length === 0) return [];

  const [firstMinimums, ...restMinimums] = sequence.map(legMinimumPriceByCurrency);
  const routeAvailable = Math.min(...sequence.map((f) => f.available));

  const pricing: RoutePricing[] = [];
  for (const [currency, firstAmount] of firstMinimums) {
    let total = firstAmount;
    let offeredOnEveryLeg = true;

    for (const legMinimums of restMinimums) {
      const amount = legMinimums.get(currency);
      if (amount === undefined) {
        offeredOnEveryLeg = false;
        break;
      }
      total += amount;
    }

    if (offeredOnEveryLeg) {
      pricing.push({ currency, available: routeAvailable, minimum: Math.round(total * 100) / 100 });
    }
  }
  return pricing;
}

// Wrap ordered flight sequences into Routes. Route metadata (time, distance, price,
// availability, pricing) is aggregated across the sequence — the Normalization step in
// FLIGHT_GENERATOR.md.
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
      pricing: aggregateRouteMinimumPricing(seq),
    };
  });
}
