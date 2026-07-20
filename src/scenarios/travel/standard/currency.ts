import fs from 'fs';
import path from 'path';

// Resolved relative to process.cwd(), not import.meta.url — same reasoning as store.ts's
// TRAVEL_DIR: once esbuild bundles this into dist/index.js, import.meta.url no longer points
// at the original src/ path.
const CURRENCY_RATES_PATH = path.resolve(process.cwd(), 'src/scenarios/travel/currency_rates.csv');

// currency_rates.csv is small (~120 rows) and static for the process lifetime, so it's parsed
// once and kept in memory rather than re-read per request — same in-memory-only approach as
// the rest of this project's caching (see CLAUDE.md).
let rates: Map<string, number> | undefined;

function loadRates(): Map<string, number> {
  const csv = fs.readFileSync(CURRENCY_RATES_PATH, 'utf-8');
  const map = new Map<string, number>();
  for (const line of csv.trim().split('\n').slice(1)) {
    const [code, rate] = line.split(',');
    if (code && rate) {
      map.set(code.trim(), Number(rate));
    }
  }
  return map;
}

// Units of `currencyCode` equal to 1 USD (currency_rates.csv's rate_usd column), or undefined
// if the currency isn't in the reference table.
export function getRateToUsd(currencyCode: string): number | undefined {
  if (!rates) {
    rates = loadRates();
  }
  return rates.get(currencyCode);
}

// Converts a USD amount into `currencyCode`, or undefined if that currency has no known rate.
export function convertFromUsd(amountUsd: number, currencyCode: string): number | undefined {
  const rate = getRateToUsd(currencyCode);
  if (rate === undefined) return undefined;
  return Math.round(amountUsd * rate * 100) / 100;
}
