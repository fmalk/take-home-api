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
// field trim needed.
export const v4FlightPricingItemSchema = flightPricingResultItemSchema;
// v4 routes always show RoutePricing's cheapest-bookable-fare shape as-is, same as v3.
export const v4RoutePricingItemSchema = routePricingResultItemSchema;

// v4 exposes `shortLived` (see standard/openapi.ts's loginBodySchema), same as v3, so it uses
// the base schema unmodified.
export const v4LoginBodySchema = loginBodySchema;

// v4 sells every seat individually, same as v3: purchase drops the flat `price` in favor of
// `seats`, one FlightSeatSelection per flight (outbound + inbound) — see v4/types.ts's
// FlightSeatSelection and v4/controller.ts's purchase validation.
// v4 uses the shared base shape as-is, same pattern as v4FlightPricingItemSchema.
export const v4FlightSeatSelectionSchema = flightSeatSelectionSchema;

export const v4PurchaseBodySchema = {
  ...omitSchemaFields(purchaseBodySchema, ['price']),
  required: ['mode', 'outboundId', 'currency', 'seats'],
  properties: {
    ...omitSchemaFields(purchaseBodySchema, ['price']).properties,
    seats: {
      type: 'array',
      description: 'One seat selection per flight across the outbound (and inbound, for RoundTrip) routes',
      items: v4FlightSeatSelectionSchema,
    },
  },
};
