import fs from 'fs';
import path from 'path';

// Resolved relative to process.cwd(), not import.meta.url — same reasoning as store.ts's
// TRAVEL_DIR: esbuild bundles this module into dist/index.js, which would otherwise resolve to
// the bundle's own location instead of this file's real path.
const CURRENCY_RATES_PATH = path.resolve(process.cwd(), 'src/scenarios/travel/currency_rates.csv');

let rates: Map<string, number> | undefined;

// currency_rates.csv rows are `currency_code,rate_usd` — units of that currency per 1 USD.
function loadRates(): Map<string, number> {
  if (!rates) {
    const [, ...rows] = fs.readFileSync(CURRENCY_RATES_PATH, 'utf-8').trim().split(/\r?\n/);
    rates = new Map(
      rows.map((row) => {
        const [code, rate] = row.split(',');
        return [code, Number(rate)];
      }),
    );
  }
  return rates;
}

// Converts a USD amount into `currency` using currency_rates.csv. Falls back to the USD amount
// unchanged if the currency has no known rate (shouldn't happen — every airport's localCurrency
// is sourced from the same CSV build as currency_rates.csv).
export function convertFromUsd(amountUsd: number, currency: string): number {
  if (currency === 'USD') return amountUsd;

  const rate = loadRates().get(currency);
  if (rate === undefined) return amountUsd;

  return Math.round(amountUsd * rate * 100) / 100;
}
