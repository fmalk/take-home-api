import {
  findDirectFlights,
  findConnectingRoutes,
  applyTimeFlow,
  applyAirlineWeighting,
  applyNormalization,
  groupRoutes,
} from './generator.js';
import type { Flight, Route } from './types.js';

// Parses generator.ts's "YYYY-MM-DD HH:MM UTC+/-N" timestamp format (see formatLocalTimestamp)
// back into an epoch-millisecond instant, so legs stamped in different airport-local offsets
// can still be compared chronologically.
function parseTimestamp(ts: string): number {
  const match = ts.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC([+-]\d+(?:\.\d+)?)$/);
  if (!match) throw new Error(`Unparseable timestamp: ${ts}`);
  const [, y, mo, d, h, mi, offset] = match;
  const localMillis = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  return localMillis - Number(offset) * 3600_000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Independent re-derivation of the "Route Normalization" pricing rule (FLIGHT_GENERATOR.md):
// per currency, the cheaper of regular/economy on each leg, summed — but only for currencies
// every leg actually offers. Written from the spec rather than by calling the generator's own
// (unexported) aggregation function, so it can catch the generator drifting from its own rules.
function expectedMinimumPricing(flights: Flight[]): Map<string, number> {
  const perLegMinimums = flights.map((leg) => {
    const minimums = new Map<string, number>();
    for (const entry of leg.pricing) {
      const price = entry.regular ?? entry.economy;
      if (price === undefined) continue;
      const current = minimums.get(entry.currency);
      if (current === undefined || price < current) minimums.set(entry.currency, price);
    }
    return minimums;
  });

  const [first, ...rest] = perLegMinimums;
  const totals = new Map<string, number>();
  for (const [currency, amount] of first ?? []) {
    let total = amount;
    let offeredByEveryLeg = true;
    for (const legMinimums of rest) {
      const legAmount = legMinimums.get(currency);
      if (legAmount === undefined) {
        offeredByEveryLeg = false;
        break;
      }
      total += legAmount;
    }
    if (offeredByEveryLeg) totals.set(currency, round2(total));
  }
  return totals;
}

// Checks every "Route Normalization" invariant from FLIGHT_GENERATOR.md against a generated
// Route[] response: aggregated fields must be exactly derivable from `flights`, and no leg may
// depart before its predecessor lands or before the current instant.
function assertRouteConsistency(routes: Route[]): void {
  expect(routes.length).toBeGreaterThan(0);

  for (const route of routes) {
    expect(route.flights.length).toBeGreaterThan(0);

    const timeSum = route.flights.reduce((sum, f) => sum + f.flightTimeHours, 0);
    expect(route.flightTimeHours).toBe(timeSum);

    const distanceSum = route.flights.reduce((sum, f) => sum + f.flightDistanceKms, 0);
    expect(route.flightDistanceKms).toBe(distanceSum);

    expect(route.departure).toEqual(route.flights[0].departure);
    expect(route.arrival).toEqual(route.flights[route.flights.length - 1].arrival);

    const minAvailable = Math.min(...route.flights.map((f) => f.available));
    expect(route.available).toBe(minAvailable);

    // Exact pricing sums.
    const priceSum = route.flights.reduce((sum, f) => sum + f.price, 0);
    expect(route.price).toBe(priceSum);

    const expectedMinimums = expectedMinimumPricing(route.flights);
    expect(route.pricing.length).toBe(expectedMinimums.size);
    for (const entry of route.pricing) {
      expect(expectedMinimums.get(entry.currency)).toBe(entry.minimum);
      expect(entry.available).toBe(route.available);

      // `price` always falls back to the 'regular' tier (see derivePrice), while `minimum`
      // takes the cheaper of regular/economy per leg — minimum can never meaningfully exceed
      // it (a tiny epsilon absorbs float noise: `price` is an unrounded running sum, `minimum`
      // is rounded to cents, so an all-regular route can differ by ~1e-13).
      if (entry.currency === 'USD') {
        expect(entry.minimum).toBeLessThanOrEqual(route.price + 1e-9);
      }
    }

    // No leg departs before the previous leg in the same route arrives, and nothing departs
    // in the past.
    let previousArrival: number | undefined;
    for (const leg of route.flights) {
      const departure = parseTimestamp(leg.departure.timestamp);
      const arrival = parseTimestamp(leg.arrival.timestamp);

      expect(arrival).toBeGreaterThan(departure);
      if (previousArrival !== undefined) {
        expect(departure).toBeGreaterThanOrEqual(previousArrival);
      }
      previousArrival = arrival;
    }

    expect(parseTimestamp(route.flights[0].departure.timestamp)).toBeGreaterThan(Date.now());
  }
}

async function generateRoutes(from: string, to: string, date: string): Promise<Route[]> {
  const direct = await findDirectFlights(from, to, date, 5);
  const sequences = direct.length > 0 ? direct.map((f) => [f]) : await findConnectingRoutes(from, to, date);
  const timed = await applyTimeFlow(sequences, date);
  return groupRoutes(timed);
}

// Far enough out that "today"-only departure-window edge cases (see the dedicated test below)
// don't apply.
const FUTURE_DATE = '2027-03-15';

describe('generated Route[] consistency', () => {
  it('holds for a direct-flight route (regional pair sharing an airline)', async () => {
    const routes = await generateRoutes('HIR', 'INU', FUTURE_DATE);
    assertRouteConsistency(routes);
    expect(routes.every((r) => r.flights.length === 1)).toBe(true);
  });

  it('holds for multi-leg connecting routes (hub-to-hub)', async () => {
    const routes = await generateRoutes('ATL', 'DXB', FUTURE_DATE);
    assertRouteConsistency(routes);
    expect(routes.some((r) => r.flights.length > 1)).toBe(true);
  });

  it('holds when searching on the current day (6-hour departure floor)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const routes = await generateRoutes('ATL', 'DXB', today);
    assertRouteConsistency(routes);
  });
});

let flightCounter = 0;

// Fictional AAA/BBB airports: fine for groupRoutes, which only aggregates fields already on the
// Flight objects and never touches the store.
function makeFlight(overrides: Partial<Flight> = {}): Flight {
  flightCounter += 1;
  return {
    id: `flight-${flightCounter}`,
    flightTimeHours: 2,
    flightDistanceKms: 1000,
    departure: { timestamp: '2027-01-01 08:00 UTC+0', airport: 'AAA' },
    arrival: { timestamp: '2027-01-01 10:00 UTC+0', airport: 'BBB' },
    travelInfo: { airline: 'XX', aircraft: 'Test Plane', flightNumber: 'XX 0001' },
    price: 100,
    pricing: [{ currency: 'USD', available: 50, regular: 100 }],
    available: 50,
    ...overrides,
  };
}

describe('groupRoutes Normalization (synthetic)', () => {
  it('sums price, time and distance exactly across legs, and takes the min availability', () => {
    const legA = makeFlight({ price: 100.5, flightTimeHours: 2, flightDistanceKms: 1000, available: 20 });
    const legB = makeFlight({ price: 250.25, flightTimeHours: 3.5, flightDistanceKms: 2000, available: 15 });

    const [route] = groupRoutes([[legA, legB]]);

    expect(route.price).toBe(350.75);
    expect(route.flightTimeHours).toBe(5.5);
    expect(route.flightDistanceKms).toBe(3000);
    expect(route.available).toBe(15);
    expect(route.departure).toBe(legA.departure);
    expect(route.arrival).toBe(legB.arrival);
  });

  it('takes the cheaper of regular/economy per leg for `minimum`, which can undercut the flat `price`', () => {
    const legA = makeFlight({
      price: 100,
      pricing: [{ currency: 'USD', available: 20, regular: 100 }],
      available: 20,
    });
    const legB = makeFlight({
      price: 200, // derivePrice always prefers 'regular', even though economy is cheaper here
      pricing: [
        { currency: 'USD', available: 15, regular: 200 },
        { currency: 'USD', available: 15, economy: 140 },
      ],
      available: 15,
    });

    const [route] = groupRoutes([[legA, legB]]);

    expect(route.price).toBe(300);
    expect(route.pricing).toEqual([{ currency: 'USD', available: 15, minimum: 240 }]);
    expect(route.pricing[0].minimum).toBeLessThan(route.price);
  });

  it('only includes a currency in `pricing` when every leg offers it', () => {
    const legA = makeFlight({
      pricing: [
        { currency: 'USD', available: 10, regular: 100 },
        { currency: 'EUR', available: 10, regular: 92 },
      ],
    });
    const legB = makeFlight({
      pricing: [{ currency: 'USD', available: 10, regular: 150 }],
    });

    const [route] = groupRoutes([[legA, legB]]);

    expect(route.pricing.map((p) => p.currency)).toEqual(['USD']);
  });

  // Working as intended, not a bug: `pricing.available` reports the leg's whole-plane pool (the
  // same figure as `route.available`), not the seat count specific to whichever class (regular
  // or economy) actually won that leg's `minimum` fare. A travel agent browsing sees "45 seats
  // on this flight" even though only a handful of those 45 are sellable at the cheapest fare —
  // realistic enough for browsing; a user wanting to book more than the cheap-fare class holds
  // would need to redo the search with stricter params (not modeled in this project).
  it('reports the leg`s full available pool alongside `minimum`, not the cheaper class`s own (smaller) pool', () => {
    const leg = makeFlight({
      available: 45,
      pricing: [
        { currency: 'USD', available: 38, regular: 200 },
        { currency: 'USD', available: 7, economy: 140 }, // cheaper fare, far fewer seats
      ],
    });

    const [route] = groupRoutes([[leg]]);

    expect(route.pricing).toEqual([{ currency: 'USD', available: 45, minimum: 140 }]);
    expect(route.pricing[0].available).toBeGreaterThan(7);
  });

  it('a zero-availability leg zeroes out the whole route`s availability (and pricing.available)', () => {
    const legA = makeFlight({ available: 30, pricing: [{ currency: 'USD', available: 30, regular: 100 }] });
    const legB = makeFlight({ available: 0, pricing: [{ currency: 'USD', available: 0, regular: 50 }] });

    const [route] = groupRoutes([[legA, legB]]);

    expect(route.available).toBe(0);
    expect(route.pricing).toEqual([{ currency: 'USD', available: 0, minimum: 150 }]);
  });
});

// Minimal Flight for applyTimeFlow, which (unlike groupRoutes) looks up `from`/`to` in the
// store, so airports must be real IATA codes from travel.sqlite. Timestamps are placeholders,
// overwritten by applyTimeFlow.
function makeRawLeg(from: string, to: string, overrides: Partial<Flight> = {}): Flight {
  flightCounter += 1;
  return {
    id: `leg-${flightCounter}`,
    flightTimeHours: 2,
    flightDistanceKms: 1500,
    departure: { timestamp: FUTURE_DATE, airport: from },
    arrival: { timestamp: FUTURE_DATE, airport: to },
    travelInfo: { airline: 'XX', aircraft: 'Test Plane', flightNumber: 'XX 0001' },
    price: 100,
    pricing: [{ currency: 'USD', available: 50, regular: 100 }],
    available: 50,
    ...overrides,
  };
}

describe('applyTimeFlow ordering', () => {
  it('never lets a leg depart before the previous leg in its sequence arrives, across branching sequences', async () => {
    // Two sequences sharing the same first-leg Flight *instance* (ATL->LIS), diverging after —
    // mirrors how findConnectingRoutes reuses cached legs across route combinations.
    const sharedFirstLeg = makeRawLeg('ATL', 'LIS');
    const branchA = makeRawLeg('LIS', 'DXB');
    const branchB = makeRawLeg('LIS', 'IST');

    const sequences = [
      [sharedFirstLeg, branchA],
      [sharedFirstLeg, branchB],
    ];

    const [timedA, timedB] = await applyTimeFlow(sequences, FUTURE_DATE);

    for (const sequence of [timedA, timedB]) {
      for (let i = 1; i < sequence.length; i++) {
        expect(parseTimestamp(sequence[i].departure.timestamp)).toBeGreaterThanOrEqual(
          parseTimestamp(sequence[i - 1].arrival.timestamp),
        );
      }
    }

    // The shared instance must be timestamped exactly once, not re-derived per sequence.
    expect(timedA[0]).toBe(timedB[0]);
    expect(timedA[0].departure.timestamp).toBe(timedB[0].departure.timestamp);
  });
});

function leg(from: string, to: string, airline: string): Flight {
  return makeRawLeg(from, to, { travelInfo: { airline, aircraft: 'Test Plane', flightNumber: `${airline} 0001` } });
}

function usesAirline(sequences: Flight[][], airline: string): boolean {
  return sequences.some((seq) => seq.some((f) => f.travelInfo.airline === airline));
}

// Array(n).fill([...]) would alias the same inner array across every slot — each route needs
// its own distinct sequence.
function repeat(n: number, from: string, to: string, airline: string): Flight[][] {
  return Array.from({ length: n }, () => [leg(from, to, airline)]);
}

// CDG/LOS/GRU/MAO are real non-regional hubs in travel.sqlite; HIR is a real regional airport.
// DH/FD/KU/UT (firstClass) and EI/RC/AL/BL (businessClass) are real fictional-roster airlines
// flagged premium (hasFirstClass or hasBusinessClass) but still mixed-cabin (they also sell
// regular seats); NA/SN/KI/ZZ/6I/MB/DI/HJ are real fictional airlines with no premium flag at
// all — chosen so top/bottom selection is unambiguous (no count ties at the boundary),
// exercising real store lookups without depending on Path Flow's combinatorics. NV is the
// roster's real premium-only carrier (no regular/economy tier — see isPremiumOnly).
describe('applyAirlineWeighting', () => {
  it('trims a hub-to-hub edge over the threshold to top-3 + bottom-3, retaining a premium option', async () => {
    const sequences: Flight[][] = [
      // CDG->LOS: 8 distinct airlines, desc by count: NA(10) SN(8) KI(6) ZZ(5) EI(4) MB(3) 6I(2) HJ(1).
      // top3={NA,SN,KI}, bottom3={MB,6I,HJ} — none premium, so EI (the first premium airline in
      // descending order among those cut) is added back in as a 7th survivor. Only ZZ is cut.
      ...repeat(10, 'CDG', 'LOS', 'NA'),
      ...repeat(8, 'CDG', 'LOS', 'SN'),
      ...repeat(6, 'CDG', 'LOS', 'KI'),
      ...repeat(5, 'CDG', 'LOS', 'ZZ'),
      ...repeat(4, 'CDG', 'LOS', 'EI'),
      ...repeat(3, 'CDG', 'LOS', 'MB'),
      ...repeat(2, 'CDG', 'LOS', '6I'),
      [leg('CDG', 'LOS', 'HJ')],
    ];

    const result = await applyAirlineWeighting(sequences);

    for (const survivor of ['NA', 'SN', 'KI', 'MB', '6I', 'HJ', 'EI']) {
      expect(usesAirline(result, survivor)).toBe(true);
    }
    expect(usesAirline(result, 'ZZ')).toBe(false);
  });

  it('always retains a premium-only carrier (e.g. NV) on a trimmed edge, even outside the top/bottom cut', async () => {
    const sequences: Flight[][] = [
      // CDG->LOS: 8 distinct airlines; NV sits squarely in the middle of the pack (would
      // otherwise be cut), but premium-only carriers always survive this stage regardless.
      ...repeat(10, 'CDG', 'LOS', 'NA'),
      ...repeat(8, 'CDG', 'LOS', 'SN'),
      ...repeat(6, 'CDG', 'LOS', 'KI'),
      ...repeat(5, 'CDG', 'LOS', 'ZZ'),
      ...repeat(4, 'CDG', 'LOS', 'NV'),
      ...repeat(3, 'CDG', 'LOS', 'MB'),
      ...repeat(2, 'CDG', 'LOS', '6I'),
      [leg('CDG', 'LOS', 'HJ')],
    ];

    const result = await applyAirlineWeighting(sequences);

    expect(usesAirline(result, 'NV')).toBe(true);
  });

  it('leaves a hub-to-hub edge at or under the threshold untouched', async () => {
    const sequences: Flight[][] = [[leg('GRU', 'MAO', 'DH')], [leg('GRU', 'MAO', 'FD')], [leg('GRU', 'MAO', 'KU')]];

    const result = await applyAirlineWeighting(sequences);

    expect(result).toEqual(sequences);
  });

  it('never trims connector legs (regional or standard→hub), only hub-to-hub', async () => {
    // 7 distinct airlines on a regional connector leg — well over the hub-to-hub threshold,
    // but connector legs are out of scope entirely.
    const sequences: Flight[][] = [
      [leg('HIR', 'INU', 'DH')],
      [leg('HIR', 'INU', 'FD')],
      [leg('HIR', 'INU', 'KU')],
      [leg('HIR', 'INU', 'EI')],
      [leg('HIR', 'INU', 'RC')],
      [leg('HIR', 'INU', 'NA')],
      [leg('HIR', 'INU', 'SN')],
    ];

    const result = await applyAirlineWeighting(sequences);

    expect(result).toEqual(sequences);
  });

  it('never empties out a long multi-hop route: VIX->UBN (real 5-hub-leg path) survives weighting', async () => {
    const date = '2027-03-15';
    const sequences = await findConnectingRoutes('VIX', 'UBN', date);
    expect(sequences.length).toBeGreaterThan(0);

    const timed = await applyTimeFlow(sequences, date);
    const weighted = await applyAirlineWeighting(timed);

    expect(weighted.length).toBeGreaterThan(0);
  });

  it('never empties out a long multi-hop route: VIX->HHN (real path via the MAO->LIS hub-to-hub leg) survives weighting', async () => {
    const date = '2027-03-15';
    const sequences = await findConnectingRoutes('VIX', 'HHN', date);
    expect(sequences.length).toBeGreaterThan(0);
    expect(sequences.some((seq) => seq.some((f) => f.departure.airport === 'MAO' && f.arrival.airport === 'LIS'))).toBe(
      true,
    );

    const timed = await applyTimeFlow(sequences, date);
    const weighted = await applyAirlineWeighting(timed);

    expect(weighted.length).toBeGreaterThan(0);
  });
});

describe('applyNormalization: per-class seat pool splitting', () => {
  it('splits a single class across its own pricing rows using the full available count', async () => {
    const flight = makeFlight({
      available: 20,
      pricing: [
        { currency: 'USD', available: 20, regular: 100 },
        { currency: 'EUR', available: 20, regular: 92 },
      ],
    });

    const [[result]] = await applyNormalization([[flight]]);

    expect(result.pricing.every((p) => p.available === 20)).toBe(true);
    expect(result.available).toBe(20);
  });

  it('splits available across offered classes by weight (first 1 : business 2 : regular 6 : economy 7) and sums back exactly', async () => {
    const flight = makeFlight({
      available: 160,
      pricing: [
        { currency: 'USD', available: 160, firstClass: 500 },
        { currency: 'USD', available: 160, businessClass: 300 },
        { currency: 'USD', available: 160, regular: 100 },
        { currency: 'USD', available: 160, economy: 70 },
      ],
    });

    const [[result]] = await applyNormalization([[flight]]);

    const byClass: Record<string, number> = {};
    for (const entry of result.pricing) {
      if (entry.firstClass !== undefined) byClass.firstClass = entry.available;
      if (entry.businessClass !== undefined) byClass.businessClass = entry.available;
      if (entry.regular !== undefined) byClass.regular = entry.available;
      if (entry.economy !== undefined) byClass.economy = entry.available;
    }

    // weights 1:2:6:7 over 16 shares of 160 => 10:20:60:70
    expect(byClass).toEqual({ firstClass: 10, businessClass: 20, regular: 60, economy: 70 });
    expect(Object.values(byClass).reduce((a, b) => a + b, 0)).toBe(160);
  });

  it('omits a class entirely from the weighting when the airline does not offer it (hasRegularClass: false case)', async () => {
    const flight = makeFlight({
      available: 30,
      pricing: [
        { currency: 'USD', available: 30, firstClass: 500 },
        { currency: 'USD', available: 30, businessClass: 300 },
      ],
    });

    const [[result]] = await applyNormalization([[flight]]);

    const byClass: Record<string, number> = {};
    for (const entry of result.pricing) {
      if (entry.firstClass !== undefined) byClass.firstClass = entry.available;
      if (entry.businessClass !== undefined) byClass.businessClass = entry.available;
    }

    // only first(1)/business(2) offered => 1/3 and 2/3 of 30
    expect(byClass).toEqual({ firstClass: 10, businessClass: 20 });
  });

  it('gives every offered class at least 1 seat, even one whose weighted share rounds to 0', async () => {
    const flight = makeFlight({
      available: 10,
      pricing: [
        { currency: 'USD', available: 10, firstClass: 500 },
        { currency: 'USD', available: 10, economy: 70 },
      ],
    });

    const [[result]] = await applyNormalization([[flight]]);

    const byClass: Record<string, number> = {};
    for (const entry of result.pricing) {
      if (entry.firstClass !== undefined) byClass.firstClass = entry.available;
      if (entry.economy !== undefined) byClass.economy = entry.available;
    }

    expect(byClass.firstClass).toBeGreaterThanOrEqual(1);
    expect(byClass.economy).toBeGreaterThanOrEqual(1);
    expect(byClass.firstClass + byClass.economy).toBe(10);
  });

  it('leaves Flight-level available (the aircraft pool) untouched', async () => {
    const flight = makeFlight({
      available: 45,
      pricing: [
        { currency: 'USD', available: 45, regular: 100 },
        { currency: 'USD', available: 45, economy: 70 },
      ],
    });

    const [[result]] = await applyNormalization([[flight]]);

    expect(result.available).toBe(45);
  });
});

describe('applyNormalization', () => {
  it('samples down to MAX_PRESENTED_ROUTES (50) when the (already-weighted) collection is larger', async () => {
    const sequences: Flight[][] = Array.from({ length: 60 }, () => [leg('GRU', 'MAO', 'NA')]);

    const result = await applyNormalization(sequences);

    expect(result).toHaveLength(50);
    for (const seq of result) {
      expect(sequences).toContain(seq);
    }
  });

  it('leaves collections at or under the limit untouched', async () => {
    const sequences: Flight[][] = [[leg('GRU', 'MAO', 'NA')], [leg('GRU', 'MAO', 'SN')]];

    const result = await applyNormalization(sequences);

    expect(result).toEqual(sequences);
  });
});

// NV (Navegantes Aéreos) / B0 (La Compagnie) are premium-only special cases: excluded from every
// standard airport_airlines stage and instead linked directly to just LIS/CDG/IST (see
// build-db.ts's Stage 5). They carry no `regular` flag, so pickSeatClasses never offers a
// 'regular' tier for them; and since they're never linked domestically, geographic proximity
// alone (e.g. ORY sharing France with B0) must not surface them either.
describe('NV/B0 premium-only exemption (regression)', () => {
  const date = '2027-03-15';

  it('never generates regular-tier pricing for an NV/B0 leg', async () => {
    const lisHam = await findConnectingRoutes('LIS', 'HAM', date);
    const exemptLegs = lisHam
      .flatMap((seq) => seq)
      .filter((f) => f.travelInfo.airline === 'NV' || f.travelInfo.airline === 'B0');

    expect(exemptLegs.length).toBeGreaterThan(0);
    for (const flight of exemptLegs) {
      for (const entry of flight.pricing) {
        expect(entry.regular).toBeUndefined();
      }
    }
  });

  it('does not surface NV/B0 for ORY->CDG, despite B0 sharing France with ORY (not a domestic edge)', async () => {
    const sequences = await findConnectingRoutes('ORY', 'CDG', date);

    expect(usesAirline(sequences, 'NV')).toBe(false);
    expect(usesAirline(sequences, 'B0')).toBe(false);
  });

  it('surfaces NV/B0 on at least one leg for LIS->HAM (LIS is one of their fixed hubs)', async () => {
    const sequences = await findConnectingRoutes('LIS', 'HAM', date);

    expect(usesAirline(sequences, 'NV') || usesAirline(sequences, 'B0')).toBe(true);
  });
});

// TAK-33 regression: an airline can hold a regional=1 airport_airlines edge at two airports for
// unrelated reasons (e.g. a domestic edge at its own hub, plus a separate hub-feeder edge at some
// other regular airport near a different hub it happens to reach) without ever flying between
// those two airports directly. findDirectFlights must not compose those two edges into an
// implausible long-haul "direct" flight just because the same airline shows up at both ends —
// e.g. LIS (TP's home hub) and SVX (~5300km away, a TAP Air Portugal regional edge inherited only
// via IST's hub-feeder extension) previously surfaced as a bogus direct route.
describe('findDirectFlights distance guard (regression)', () => {
  const date = '2027-03-15';

  it('does not surface a direct flight for LIS->SVX despite both sharing a regional-edge airline', async () => {
    const direct = await findDirectFlights('LIS', 'SVX', date);

    expect(direct).toHaveLength(0);
  });

  it('still finds LIS->SVX via a hub connection instead', async () => {
    const sequences = await findConnectingRoutes('LIS', 'SVX', date);

    expect(sequences.length).toBeGreaterThan(0);
  });
});
