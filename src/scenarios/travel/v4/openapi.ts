import {
  airportSchema,
  airlineSchema,
  flightSchema,
  flightPricingResultItemSchema,
  routePricingResultItemSchema,
  loginBodySchema,
  purchaseBodySchema,
  flightSeatSelectionSchema,
  omitSchemaFields,
} from '../standard/openapi.js';

// v4 is the full-surface version: no field trims on airports/airlines.
export const v4AirportSchema = airportSchema;
export const v4AirlineSchema = airlineSchema;
// v4 hides the flat `price` simplification, same as v3, but keeps every seat class.
export const v4FlightSchema = omitSchemaFields(flightSchema, ['price']);

// v4 exposes all four seat classes (regular/economy/businessClass/firstClass), same as v3 — no
// field trim needed. `currency` can additionally be 'LOY' (TAK-28's Loyalty Points), only present
// on flights whose airline has a loyalty program — see standard/generator.ts's makePricing.
export const v4FlightPricingItemSchema = {
  ...flightPricingResultItemSchema,
  properties: {
    ...flightPricingResultItemSchema.properties,
    currency: {
      type: 'string',
      description:
        "Code for currency (three letters), or 'LOY' for Loyalty Points (airline must have a loyalty program)",
    },
  },
};
// v4 routes always show RoutePricing's cheapest-bookable-fare shape as-is, same as v3. LOY never
// appears here — it's excluded from the route's cheapest-bookable-fare `minimum` rollup (see
// generator.ts's legMinimumPriceByCurrency).
export const v4RoutePricingItemSchema = routePricingResultItemSchema;

// v4 exposes `shortLived` (see standard/openapi.ts's loginBodySchema), same as v3, so it uses
// the base schema unmodified.
export const v4LoginBodySchema = loginBodySchema;

// v4 sells every seat individually, same as v3: purchase drops the flat `price` in favor of
// `seats`, one FlightSeatSelection per flight (outbound + inbound) — see v4/types.ts's
// FlightSeatSelection and v4/controller.ts's purchase validation.
// v4 uses the shared base shape as-is, same pattern as v4FlightPricingItemSchema.
export const v4FlightSeatSelectionSchema = flightSeatSelectionSchema;

// TAK-28: `currency: 'LOY'` is allowed here — since every seat selection must match this single
// request-level currency (see v4/controller.ts's CURRENCY_MISMATCH check), submitting LOY at
// this level already enforces "every seat in the purchase is bought with LOY, never mixed with
// another currency" without any extra per-seat validation.
export const v4PurchaseBodySchema = {
  ...omitSchemaFields(purchaseBodySchema, ['price']),
  required: ['mode', 'outboundId', 'currency', 'seats'],
  properties: {
    ...omitSchemaFields(purchaseBodySchema, ['price']).properties,
    currency: {
      type: 'string',
      description:
        "Currency code (three letters) for the agreed price, or 'LOY' for Loyalty Points — applies to every seat in this purchase",
    },
    seats: {
      type: 'array',
      description: 'One seat selection per flight across the outbound (and inbound, for RoundTrip) routes',
      items: v4FlightSeatSelectionSchema,
    },
  },
};

// v4 paginates search results at 15 routes per leg (see v4/types.ts's SEARCH_PAGE_SIZE); the
// search response's outbound/inbound arrays only ever carry the current page, alongside these
// current/total page counts so a client knows whether to walk /search/pages for more.
export const v4SearchPaginationProperties = {
  outboundCurrentPage: { type: 'number', description: 'Current page (1-based) of the outbound routes returned' },
  outboundTotalPages: { type: 'number', description: 'Total number of outbound pages available' },
  inboundCurrentPage: { type: 'number', description: 'Current page (1-based) of the inbound routes returned' },
  inboundTotalPages: { type: 'number', description: 'Total number of inbound pages available' },
};

export const v4SearchPagesQuerystring = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Search ID returned by GET /search' },
    outboundPage: { type: 'string', description: 'Page number (1-based) of outbound routes to fetch' },
    inboundPage: { type: 'string', description: 'Page number (1-based) of inbound routes to fetch' },
  },
};
