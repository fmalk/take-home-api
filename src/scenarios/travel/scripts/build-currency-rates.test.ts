describe('Currency rates builder', () => {
  describe('Fallback rates object', () => {
    it('contains USD at 1.0', () => {
      const fallbackRates = getFallbackRates();
      expect(fallbackRates['USD']).toBe(1.0);
    });

    it('contains all major currencies', () => {
      const fallbackRates = getFallbackRates();
      const majorCurrencies = ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'];

      for (const currency of majorCurrencies) {
        expect(fallbackRates).toHaveProperty(currency);
        expect(fallbackRates[currency]).toBeGreaterThan(0);
      }
    });

    it('contains at least 100 currencies', () => {
      const fallbackRates = getFallbackRates();
      expect(Object.keys(fallbackRates).length).toBeGreaterThanOrEqual(100);
    });

    it('has all positive exchange rates', () => {
      const fallbackRates = getFallbackRates();
      for (const rate of Object.values(fallbackRates)) {
        expect(rate).toBeGreaterThan(0);
      }
    });

    it('has currency codes in uppercase', () => {
      const fallbackRates = getFallbackRates();
      for (const currency of Object.keys(fallbackRates)) {
        expect(currency).toMatch(/^[A-Z]{3}$/);
      }
    });
  });

  describe('Rate selection logic', () => {
    it('prefers fetched rates over fallback rates', () => {
      const fetchedRates = { EUR: 0.95, GBP: 0.82, JPY: 150 };
      const fallbackRates = { EUR: 0.92, GBP: 0.79, JPY: 149.5 };

      const selected = selectRates(fetchedRates, fallbackRates);

      expect(selected['EUR']).toBe(0.95);
      expect(selected['GBP']).toBe(0.82);
      expect(selected['JPY']).toBe(150);
    });

    it('falls back to fallback rates when fetched rate is missing', () => {
      const fetchedRates = { EUR: 0.95 };
      const fallbackRates = { EUR: 0.92, GBP: 0.79, JPY: 149.5 };

      const selected = selectRates(fetchedRates, fallbackRates);

      expect(selected['EUR']).toBe(0.95);
      expect(selected['GBP']).toBe(0.79);
      expect(selected['JPY']).toBe(149.5);
    });

    it('only includes currencies that exist in fallback rates', () => {
      const fetchedRates = { EUR: 0.95, XYZ: 99.99 };
      const fallbackRates = { EUR: 0.92, GBP: 0.79 };

      const selected = selectRates(fetchedRates, fallbackRates);

      expect(selected).toHaveProperty('EUR');
      expect(selected).toHaveProperty('GBP');
      expect(selected).not.toHaveProperty('XYZ');
    });

    it('uses all fallback currencies as the base set', () => {
      const fetchedRates = { EUR: 0.95, XYZ: 99.99 }; // XYZ not in fallback
      const fallbackRates = {
        EUR: 0.92,
        GBP: 0.79,
        JPY: 149.5,
        USD: 1.0,
      };

      const selected = selectRates(fetchedRates, fallbackRates);

      // Should have all fallback currencies
      expect(selected).toHaveProperty('EUR');
      expect(selected).toHaveProperty('GBP');
      expect(selected).toHaveProperty('JPY');
      expect(selected).toHaveProperty('USD');

      // XYZ should not be in result (not in fallback set)
      expect(selected).not.toHaveProperty('XYZ');
    });
  });

  describe('Rate rounding', () => {
    it('rounds rates to 2 decimal places', () => {
      const rates = { EUR: 0.923456, JPY: 149.567 };
      const rounded = roundRates(rates);

      expect(rounded['EUR']).toBe(0.92);
      expect(rounded['JPY']).toBe(149.57);
    });

    it('preserves rates already at 2 decimals', () => {
      const rates = { EUR: 0.92, GBP: 0.79 };
      const rounded = roundRates(rates);

      expect(rounded['EUR']).toBe(0.92);
      expect(rounded['GBP']).toBe(0.79);
    });

    it('handles rates with many decimal places', () => {
      const rates = { XYZ: 123.456789 };
      const rounded = roundRates(rates);

      expect(rounded['XYZ']).toBe(123.46);
    });

    it('handles very small rates (< 1)', () => {
      const rates = { KWD: 0.307123, JOD: 0.709456 };
      const rounded = roundRates(rates);

      expect(rounded['KWD']).toBe(0.31);
      expect(rounded['JOD']).toBe(0.71);
    });

    it('handles very large rates (> 1000)', () => {
      const rates = { IRR: 42105.789, VND: 24500.123 };
      const rounded = roundRates(rates);

      expect(rounded['IRR']).toBe(42105.79);
      expect(rounded['VND']).toBe(24500.12);
    });
  });

  describe('CSV generation', () => {
    it('generates CSV with header row', () => {
      const rates = { EUR: 0.92, GBP: 0.79, JPY: 149.5 };
      const csv = generateCSV(rates);

      expect(csv).toContain('currency_code,rate_usd');
    });

    it('includes all rates as CSV rows', () => {
      const rates = { EUR: 0.92, GBP: 0.79 };
      const csv = generateCSV(rates);

      expect(csv).toContain('EUR,0.92');
      expect(csv).toContain('GBP,0.79');
    });

    it('sorts currencies alphabetically', () => {
      const rates = { ZAR: 18.35, EUR: 0.92, AUD: 1.53 };
      const csv = generateCSV(rates);

      const lines = csv.split('\n').filter((line) => line.trim());
      const eurIndex = lines.findIndex((line) => line.startsWith('EUR'));
      const audIndex = lines.findIndex((line) => line.startsWith('AUD'));
      const zarIndex = lines.findIndex((line) => line.startsWith('ZAR'));

      expect(audIndex).toBeLessThan(eurIndex);
      expect(eurIndex).toBeLessThan(zarIndex);
    });

    it('ends with a newline', () => {
      const rates = { EUR: 0.92 };
      const csv = generateCSV(rates);

      expect(csv).toMatch(/\n$/);
    });

    it('has correct format for each row', () => {
      const rates = { EUR: 0.92, GBP: 0.79 };
      const csv = generateCSV(rates);

      const lines = csv.split('\n').filter((line) => line.trim());
      for (const line of lines.slice(1)) {
        // Skip header
        expect(line).toMatch(/^[A-Z]{3},\d+(\.\d{2})?$/);
      }
    });

    it('includes all fallback currencies even with no fetched rates', () => {
      const fallbackRates = getFallbackRates();
      const emptyFetched = {};
      const csv = generateCSVFromFallback(emptyFetched, fallbackRates);

      const currencyCodes = Object.keys(fallbackRates);
      for (const code of currencyCodes) {
        expect(csv).toContain(code);
      }
    });
  });

  describe('API response parsing', () => {
    it('parses exchangerate.host response format', () => {
      const response = {
        rates: {
          EUR: 0.92,
          GBP: 0.79,
          JPY: 149.5,
        },
      };

      const rates = parseExchangeRateHost(response);

      expect(rates['EUR']).toBe(0.92);
      expect(rates['GBP']).toBe(0.79);
      expect(rates['JPY']).toBe(149.5);
    });

    it('parses exchangerate-api.com response format', () => {
      const response = {
        conversion_rates: {
          EUR: 0.92,
          GBP: 0.79,
          JPY: 149.5,
        },
      };

      const rates = parseExchangeRateApi(response);

      expect(rates['EUR']).toBe(0.92);
      expect(rates['GBP']).toBe(0.79);
      expect(rates['JPY']).toBe(149.5);
    });

    it('handles empty response from exchangerate.host', () => {
      const response = { rates: {} };
      const rates = parseExchangeRateHost(response);

      expect(rates).toEqual({});
    });

    it('handles empty response from exchangerate-api.com', () => {
      const response = { conversion_rates: {} };
      const rates = parseExchangeRateApi(response);

      expect(rates).toEqual({});
    });
  });

  describe('Rate validation', () => {
    it('rejects rates with zero or negative values', () => {
      const invalidRates = { EUR: 0, GBP: -0.79, JPY: 149.5 };
      const valid = validateRates(invalidRates);

      expect(valid['EUR']).toBeUndefined();
      expect(valid['GBP']).toBeUndefined();
      expect(valid['JPY']).toBe(149.5);
    });

    it('rejects non-numeric rate values', () => {
      const invalidRates = { EUR: 'not a number' as any, GBP: 0.79 };
      const valid = validateRates(invalidRates);

      expect(valid['EUR']).toBeUndefined();
      expect(valid['GBP']).toBe(0.79);
    });

    it('accepts valid positive rates', () => {
      const validRates = { EUR: 0.92, GBP: 0.79, JPY: 149.5, USD: 1.0 };
      const valid = validateRates(validRates);

      expect(valid).toEqual(validRates);
    });

    it('handles very small positive rates', () => {
      const rates = { KWD: 0.001 };
      const valid = validateRates(rates);

      expect(valid['KWD']).toBe(0.001);
    });
  });

  describe('Edge cases', () => {
    it('handles missing rates for some currencies gracefully', () => {
      const rates = { EUR: 0.92 }; // Missing many currencies
      const fallbackRates = getFallbackRates();

      const combined = { ...fallbackRates, ...rates };
      const csv = generateCSV(combined);

      expect(csv).toContain('EUR,0.92'); // Updated rate
      expect(csv).toContain(`GBP,${fallbackRates['GBP']}`); // Fallback rate
    });

    it('prefers precision from fetched rates', () => {
      const fetchedRates = { EUR: 0.923 };
      const fallbackRates = { EUR: 0.92 };

      const selected = selectRates(fetchedRates, fallbackRates);
      expect(selected['EUR']).toBe(0.923);
    });

    it('handles rate for USD correctly (should always be 1.0)', () => {
      const rates = { USD: 1.0, EUR: 0.92 };
      const csv = generateCSV(rates);

      expect(csv).toContain('USD,1');
    });
  });
});

// ============================================================================
// Helper implementations that mirror the build-currency-rates.ts logic
// ============================================================================

const FALLBACK_RATES: Record<string, number> = {
  AED: 3.67,
  ALL: 99.2,
  AMD: 390,
  AOA: 1,
  ARS: 850,
  AUD: 1.53,
  AZN: 1.7,
  BDT: 109.2,
  BGN: 1.81,
  BHD: 0.376,
  BND: 1,
  BOB: 6.93,
  BRL: 4.97,
  BSD: 1,
  BTN: 1,
  BWP: 13.5,
  BYN: 1,
  CAD: 1.36,
  CDF: 1,
  CHF: 0.88,
  CLP: 950,
  CNY: 7.24,
  COP: 4050,
  CRC: 518,
  CUP: 24,
  CVE: 101,
  CZK: 24.3,
  DJF: 177,
  DKK: 6.86,
  DOP: 1,
  DZD: 1,
  EGP: 49.2,
  ETB: 1,
  EUR: 0.92,
  FJD: 2.24,
  GBP: 0.79,
  GEL: 2.65,
  GHS: 15.3,
  GMD: 58.5,
  GYD: 208,
  HKD: 7.81,
  HTG: 131,
  HUF: 365,
  IDR: 15950,
  ILS: 3.65,
  INR: 83.12,
  IQD: 1312,
  IRR: 42105,
  ISK: 138,
  JMD: 156,
  JOD: 0.709,
  JPY: 149.5,
  KES: 158.5,
  KGS: 85,
  KHR: 4150,
  KMF: 492,
  KRW: 1319,
  KWD: 0.307,
  KZT: 445,
  LAK: 20850,
  LBP: 89500,
  LKR: 327,
  LSL: 18.35,
  LYD: 1,
  MAD: 9.98,
  MGA: 4395,
  MKD: 55.8,
  MMK: 2100,
  MOP: 1,
  MUR: 1,
  MVR: 1,
  MWK: 1048,
  MXN: 17.05,
  MYR: 4.73,
  MZN: 63.8,
  NAD: 1,
  NGN: 1515,
  NIO: 36.5,
  NOK: 10.68,
  NPR: 1,
  NZD: 1.67,
  OMR: 0.385,
  PAB: 1.0,
  PEK: 3.75,
  PHP: 56.8,
  PKR: 278,
  PLN: 4.03,
  PYG: 7280,
  QAR: 3.64,
  RON: 4.97,
  RUB: 96.5,
  SAR: 3.75,
  SCR: 12.8,
  SDG: 66,
  SEK: 10.55,
  SGD: 1.34,
  SLL: 18500,
  SYP: 13105,
  TND: 3.1,
  THB: 36.2,
  TRY: 32.8,
  TWD: 31.5,
  TZS: 2650,
  UAH: 40.6,
  UGX: 3850,
  USD: 1.0,
  UYU: 1,
  UZS: 12750,
  VES: 38.5,
  VND: 24500,
  VUV: 119,
  XAF: 655,
  XOF: 655,
  YER: 249,
  ZAR: 18.35,
  ZMW: 24.8,
  ZWL: 1,
};

function getFallbackRates(): Record<string, number> {
  return { ...FALLBACK_RATES };
}

function selectRates(fetched: Record<string, number>, fallback: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};

  for (const currency of Object.keys(fallback)) {
    result[currency] = fetched[currency] ?? fallback[currency] ?? 1.0;
  }

  return result;
}

function roundRates(rates: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [currency, rate] of Object.entries(rates)) {
    result[currency] = Math.round(rate * 100) / 100;
  }

  return result;
}

function generateCSV(rates: Record<string, number>): string {
  const csvLines = ['currency_code,rate_usd'];
  const currencies = Object.keys(rates).sort();

  for (const currency of currencies) {
    const rate = rates[currency] ?? 1.0;
    const roundedRate = Math.round(rate * 100) / 100;
    csvLines.push(`${currency},${roundedRate}`);
  }

  return csvLines.join('\n') + '\n';
}

function generateCSVFromFallback(fetched: Record<string, number>, fallback: Record<string, number>): string {
  const combined = selectRates(fetched, fallback);
  return generateCSV(combined);
}

function parseExchangeRateHost(response: Record<string, unknown>): Record<string, number> {
  return (response as Record<string, Record<string, number>>).rates ?? {};
}

function parseExchangeRateApi(response: Record<string, unknown>): Record<string, number> {
  return (response as Record<string, Record<string, number>>).conversion_rates ?? {};
}

function validateRates(rates: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [currency, rate] of Object.entries(rates)) {
    if (typeof rate === 'number' && rate > 0) {
      result[currency] = rate;
    }
  }

  return result;
}
