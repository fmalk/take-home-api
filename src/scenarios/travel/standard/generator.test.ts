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

// CDG/LOS/LIS/NBO are real non-regional hubs in travel.sqlite; HIR is a real regional airport.
// DH/FD/KU/UT (firstClass), EI/RC/AL/BL (businessClass), NA/SN/KI/ZZ/6I/DI (regular) are real
// fictional-roster airlines with those exact class flags (see FLIGHT_GENERATOR.md Airline
// Distribution Weighting) — chosen so cut/survive is unambiguous (no count ties at the cap
// boundary), so this exercises real store lookups without depending on Path Flow's combinatorics.
describe('applyAirlineWeighting', () => {
  it('caps distinct airlines per class, drops the least-represented, and reprieves an edge left with none', async () => {
    const sequences: Flight[][] = [
      // firstClass: DH(4) > FD(3) > KU(2) > UT(1) — cap 3, UT is cut.
      ...repeat(4, 'CDG', 'LOS', 'DH'),
      ...repeat(3, 'CDG', 'LOS', 'FD'),
      ...repeat(2, 'CDG', 'LOS', 'KU'),
      [leg('CDG', 'LOS', 'UT')],
      // businessClass: EI(4) > RC(3) > AL(2) > BL(1) — cap 3, BL is cut.
      ...repeat(4, 'CDG', 'LOS', 'EI'),
      ...repeat(3, 'CDG', 'LOS', 'RC'),
      ...repeat(2, 'CDG', 'LOS', 'AL'),
      [leg('CDG', 'LOS', 'BL')],
      // regular: NA(5) > SN(4) > KI(3) > ZZ(2) > 6I(1) = DI(1) — cap 4, the two lowest (6I, DI)
      // are cut. DI is the *only* airline on LIS->NBO, so it must be reprieved back in there.
      ...repeat(5, 'CDG', 'LOS', 'NA'),
      ...repeat(4, 'CDG', 'LOS', 'SN'),
      ...repeat(3, 'CDG', 'LOS', 'KI'),
      ...repeat(2, 'CDG', 'LOS', 'ZZ'),
      [leg('CDG', 'LOS', '6I')],
      [leg('LIS', 'NBO', 'DI')],
      // A route with a cut airline (UT) only on its regional leg (HIR->INU) — regional legs
      // are excluded from tallying/capping, but still enforced on removal ("every leg").
      [leg('CDG', 'LOS', 'DH'), leg('HIR', 'INU', 'UT')],
      // Control: same shape, but the regional leg uses a surviving airline — must not be cut.
      [leg('CDG', 'LOS', 'DH'), leg('HIR', 'INU', 'DH')],
    ];

    const result = await applyAirlineWeighting(sequences);

    // Cut and not reprieved anywhere: gone entirely.
    expect(usesAirline(result, 'UT')).toBe(false);
    expect(usesAirline(result, 'BL')).toBe(false);
    expect(usesAirline(result, '6I')).toBe(false);

    // Cut, but reprieved on its only edge.
    expect(usesAirline(result, 'DI')).toBe(true);

    // Under-cap survivors untouched.
    for (const survivor of ['DH', 'FD', 'KU', 'EI', 'RC', 'AL', 'NA', 'SN', 'KI', 'ZZ']) {
      expect(usesAirline(result, survivor)).toBe(true);
    }

    // A cut airline on a regional leg still disqualifies the whole route ("every leg" rule).
    expect(result.some((seq) => seq.length === 2 && seq[1].travelInfo.airline === 'UT')).toBe(false);
    // The equivalent route with a surviving airline on that same regional leg is kept.
    expect(result.some((seq) => seq.length === 2 && seq[1].travelInfo.airline === 'DH')).toBe(true);
  });

  it('leaves the collection untouched when no class exceeds its cap', async () => {
    const sequences: Flight[][] = [[leg('CDG', 'LOS', 'DH')], [leg('CDG', 'LOS', 'FD')]];

    const result = await applyAirlineWeighting(sequences);

    expect(result).toEqual(sequences);
  });
});

describe('applyNormalization', () => {
  it('skips airline weighting entirely for direct-regional route sets', async () => {
    // 4 distinct firstClass airlines on one edge — would be cut down to 3 by applyAirlineWeighting.
    const sequences: Flight[][] = [
      [leg('CDG', 'LOS', 'DH')],
      [leg('CDG', 'LOS', 'FD')],
      [leg('CDG', 'LOS', 'KU')],
      [leg('CDG', 'LOS', 'UT')],
    ];

    const result = await applyNormalization(sequences, true);

    expect(result).toHaveLength(4);
    expect(usesAirline(result, 'UT')).toBe(true);
  });

  it('samples down to MAX_PRESENTED_ROUTES (50) when the (already-weighted) collection is larger', async () => {
    const sequences: Flight[][] = Array.from({ length: 60 }, () => [leg('CDG', 'LOS', 'NA')]);

    const result = await applyNormalization(sequences, false);

    expect(result).toHaveLength(50);
    for (const seq of result) {
      expect(sequences).toContain(seq);
    }
  });
});
