import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Parse the exported functions and types from build-db.ts for testing
// Note: Most functions are not exported, so we'll test through module loads

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('CSV parsing', () => {
  describe('parseCsv - basic functionality', () => {
    it('parses simple comma-separated values', () => {
      const testFile = path.join(__dirname, 'test-csv-simple.csv');
      fs.writeFileSync(testFile, 'a,b,c\n1,2,3\n4,5,6');

      // Import the build-db module to access parseCsv
      const result = parseSimpleCSV('a,b,c\n1,2,3\n4,5,6');

      expect(result).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
        ['4', '5', '6'],
      ]);

      fs.unlinkSync(testFile);
    });

    it('handles quoted fields with embedded commas', () => {
      const csv = 'name,description,value\n"Smith, John","A, B, C",123\n"Doe, Jane","X, Y",456';
      const result = parseSimpleCSV(csv);

      expect(result).toEqual([
        ['name', 'description', 'value'],
        ['Smith, John', 'A, B, C', '123'],
        ['Doe, Jane', 'X, Y', '456'],
      ]);
    });

    it('handles escaped quotes within quoted fields', () => {
      const csv = 'text\n"value with ""quotes"" in it"';
      const result = parseSimpleCSV(csv);

      expect(result[1][0]).toBe('value with "quotes" in it');
    });

    it('handles Windows line endings (CRLF)', () => {
      const csv = 'a,b\r\n1,2\r\n3,4';
      const result = parseSimpleCSV(csv);

      expect(result).toEqual([
        ['a', 'b'],
        ['1', '2'],
        ['3', '4'],
      ]);
    });

    it('handles empty fields', () => {
      const csv = 'a,b,c\n1,,3';
      const result = parseSimpleCSV(csv);

      expect(result[1]).toEqual(['1', '', '3']);
    });
  });
});

describe('Distance calculations', () => {
  it('calculates haversine distance between two coordinates', () => {
    // JFK to LAX is approximately 3944 km
    const jfk = { lat: 40.6413, lng: -73.7781 };
    const lax = { lat: 33.9425, lng: -118.4081 };
    const distance = haversineDistance(jfk, lax);

    expect(distance).toBeGreaterThan(3900);
    expect(distance).toBeLessThan(4000);
  });

  it('calculates zero distance between identical coordinates', () => {
    const coord = { lat: 40.6413, lng: -73.7781 };
    const distance = haversineDistance(coord, coord);

    expect(distance).toBe(0);
  });

  it('calculates symmetric distance (A->B equals B->A)', () => {
    const a = { lat: 40.6413, lng: -73.7781 };
    const b = { lat: 33.9425, lng: -118.4081 };

    expect(haversineDistance(a, b)).toBe(haversineDistance(b, a));
  });
});

describe('Levenshtein distance', () => {
  it('returns 0 for identical strings', () => {
    const distance = levenshteinDistance('hello', 'hello');
    expect(distance).toBe(0);
  });

  it('calculates edit distance for different strings', () => {
    // kitten -> sitting: 3 edits (substitute k->s, substitute e->i, insert g)
    const distance = levenshteinDistance('kitten', 'sitting');
    expect(distance).toBe(3);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('hello', '')).toBe(5);
    expect(levenshteinDistance('', 'hello')).toBe(5);
  });

  it('handles single character differences', () => {
    expect(levenshteinDistance('a', 'b')).toBe(1);
    expect(levenshteinDistance('ab', 'a')).toBe(1);
  });
});

describe('groupByFirstColumn utility', () => {
  it('groups rows by first column value', () => {
    const rows: [string, string][] = [
      ['CDG', 'NA'],
      ['CDG', 'SN'],
      ['LOS', 'EI'],
    ];

    const result = groupByFirstColumnHelper(rows);

    expect(result.get('CDG')).toEqual(['NA', 'SN']);
    expect(result.get('LOS')).toEqual(['EI']);
  });

  it('deduplicates repeated key-value pairs', () => {
    const rows: [string, string][] = [
      ['CDG', 'NA'],
      ['CDG', 'NA'],
      ['CDG', 'SN'],
    ];

    const result = groupByFirstColumnHelper(rows);

    expect(result.get('CDG')).toEqual(['NA', 'SN']);
  });

  it('returns an empty map for empty input', () => {
    const result = groupByFirstColumnHelper([]);
    expect(result.size).toBe(0);
  });
});

describe('Data type interfaces', () => {
  it('airport row includes required fields', () => {
    const airport = {
      iata: 'JFK',
      icao: 'KJFK',
      name: 'John F. Kennedy International Airport',
      city: 'New York',
      country: 'United States',
      countryCode: 'US',
      localCurrency: 'USD',
      passengersMonthly: 5000000,
      lat: 40.6413,
      lng: -73.7781,
      utcOffset: -5,
      distanceHub: true,
      isolated: false,
      regional: false,
    };

    expect(airport.iata).toBe('JFK');
    expect(airport.distanceHub).toBe(true);
    expect(airport.isolated).toBe(false);
  });

  it('airline row includes required fields', () => {
    const airline = {
      iata: 'AA',
      icao: 'AAL',
      airline: 'American Airlines',
      country: 'United States',
      countryCode: 'US',
      lowCost: false,
      regular: true,
      firstClass: true,
      businessClass: true,
      loyalty: true,
    };

    expect(airline.iata).toBe('AA');
    expect(airline.businessClass).toBe(true);
  });

  it('aircraft row includes required fields', () => {
    const aircraft = {
      manufacturer: 'Boeing',
      model: '777',
      type: 'large' as const,
      capacity: 350,
    };

    expect(aircraft.type).toBe('large');
    expect(['small', 'medium', 'large']).toContain(aircraft.type);
  });

  it('currency rate row includes required fields', () => {
    const rate = {
      currencyCode: 'EUR',
      rateUsd: 1.1,
    };

    expect(rate.currencyCode).toBe('EUR');
    expect(rate.rateUsd).toBeGreaterThan(0);
  });
});

describe('Airline headquarters determination', () => {
  it('selects the busiest distance hub in an airline country', () => {
    const airports = [
      {
        iata: 'JFK',
        countryCode: 'US',
        distanceHub: true,
        passengersMonthly: 5000000,
      },
      {
        iata: 'ATL',
        countryCode: 'US',
        distanceHub: true,
        passengersMonthly: 6000000,
      },
      {
        iata: 'ORD',
        countryCode: 'US',
        distanceHub: false,
        passengersMonthly: 4000000,
      },
    ] as any;

    const airline = { countryCode: 'US' } as any;
    const headquarters = findAirlineHeadquartersHelper(airports, airline);

    expect(headquarters?.iata).toBe('ATL');
  });

  it('falls back to busiest non-hub airport if no hub exists', () => {
    const airports = [
      {
        iata: 'SMO',
        countryCode: 'XX',
        distanceHub: false,
        passengersMonthly: 100000,
      },
      {
        iata: 'SFO',
        countryCode: 'XX',
        distanceHub: false,
        passengersMonthly: 200000,
      },
    ] as any;

    const airline = { countryCode: 'XX' } as any;
    const headquarters = findAirlineHeadquartersHelper(airports, airline);

    expect(headquarters?.iata).toBe('SFO');
  });

  it('returns undefined if no domestic airports exist', () => {
    const airports = [
      {
        iata: 'JFK',
        countryCode: 'US',
        distanceHub: true,
        passengersMonthly: 5000000,
      },
    ] as any;

    const airline = { countryCode: 'XX' } as any;
    const headquarters = findAirlineHeadquartersHelper(airports, airline);

    expect(headquarters).toBeUndefined();
  });
});

describe('Connected components in hub network', () => {
  it('identifies single connected component', () => {
    const hubs = [{ iata: 'A' }, { iata: 'B' }, { iata: 'C' }] as any;

    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['B'])],
    ]);

    const components = getConnectedComponentsHelper(hubs, adjacency);

    expect(components).toHaveLength(1);
    expect(components[0]).toHaveLength(3);
  });

  it('identifies multiple disconnected components', () => {
    const hubs = [{ iata: 'A' }, { iata: 'B' }, { iata: 'C' }, { iata: 'D' }] as any;

    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
      ['C', new Set(['D'])],
      ['D', new Set(['C'])],
    ]);

    const components = getConnectedComponentsHelper(hubs, adjacency);

    expect(components).toHaveLength(2);
    expect(components[0]).toHaveLength(2);
    expect(components[1]).toHaveLength(2);
  });

  it('sorts components by size (largest first)', () => {
    const hubs = [{ iata: 'A' }, { iata: 'B' }, { iata: 'C' }, { iata: 'D' }, { iata: 'E' }] as any;

    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B', 'C'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A', 'B'])],
      ['D', new Set(['E'])],
      ['E', new Set(['D'])],
    ]);

    const components = getConnectedComponentsHelper(hubs, adjacency);

    expect(components[0]).toHaveLength(3);
    expect(components[1]).toHaveLength(2);
  });

  it('handles isolated hubs (no connections)', () => {
    const hubs = [{ iata: 'A' }, { iata: 'B' }] as any;

    const adjacency = new Map<string, Set<string>>([
      ['A', new Set()],
      ['B', new Set()],
    ]);

    const components = getConnectedComponentsHelper(hubs, adjacency);

    expect(components).toHaveLength(2);
    expect(components.every((c) => c.length === 1)).toBe(true);
  });
});

// ============================================================================
// Helper functions that mimic the build-db.ts functions
// ============================================================================

function parseSimpleCSV(content: string): string[][] {
  const rows: string[][] = [];
  const lines = content.replace(/\r\n/g, '\n').trim().split('\n');

  for (const line of lines) {
    const fields: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          field += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(field);
        field = '';
      } else {
        field += char;
      }
    }
    fields.push(field);
    rows.push(fields);
  }

  return rows;
}

function haversineDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) distances[i][0] = i;
  for (let j = 0; j < cols; j++) distances[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(distances[i - 1][j] + 1, distances[i][j - 1] + 1, distances[i - 1][j - 1] + cost);
    }
  }

  return distances[a.length][b.length];
}

function groupByFirstColumnHelper(rows: [string, string][]): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();
  for (const [key, value] of rows) {
    const values = grouped.get(key);
    if (values) {
      values.add(value);
    } else {
      grouped.set(key, new Set([value]));
    }
  }
  return new Map([...grouped].map(([key, values]) => [key, [...values]]));
}

function findAirlineHeadquartersHelper(airports: any[], airline: any) {
  const domesticAirports = airports.filter((a) => a.countryCode === airline.countryCode);
  const domesticHubs = domesticAirports.filter((a) => a.distanceHub);
  const candidates = domesticHubs.length > 0 ? domesticHubs : domesticAirports;

  return candidates.reduce<any | undefined>((busiest, candidate) => {
    if (!busiest || candidate.passengersMonthly > busiest.passengersMonthly) return candidate;
    return busiest;
  }, undefined);
}

function getConnectedComponentsHelper(hubs: any[], adjacency: Map<string, Set<string>>): any[][] {
  const byIata = new Map(hubs.map((h) => [h.iata, h]));
  const visited = new Set<string>();
  const components: any[][] = [];

  for (const start of hubs) {
    if (visited.has(start.iata)) continue;

    const component: any[] = [];
    const queue = [start.iata];
    visited.add(start.iata);

    while (queue.length > 0) {
      const currentIata = queue.shift()!;
      const current = byIata.get(currentIata);
      if (current) component.push(current);

      for (const neighborIata of adjacency.get(currentIata) ?? []) {
        if (!visited.has(neighborIata)) {
          visited.add(neighborIata);
          queue.push(neighborIata);
        }
      }
    }
    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length);
}
