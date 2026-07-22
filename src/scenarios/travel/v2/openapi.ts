import {
  airportSchema,
  airlineSchema,
  flightSchema,
  flightPricingResultItemSchema,
  routePricingResultItemSchema,
  loginBodySchema,
  omitSchemaFields,
} from '../standard/openapi.js';

// v2 is the full-surface version: no field trims on airports/airlines.
export const v2AirportSchema = airportSchema;
export const v2AirlineSchema = airlineSchema;
// v2 hides the flat `price` simplification, keeping the per-class `pricing` breakdown.
export const v2FlightSchema = omitSchemaFields(flightSchema, ['price']);

// v2 flights only ever sell the `regular` tier (economy/business/first are reserved for a
// future, more granular version) but still show it in every currency the flight offers.
export const v2FlightPricingItemSchema = omitSchemaFields(flightPricingResultItemSchema, [
  'economy',
  'businessClass',
  'firstClass',
]);
// v2 routes always show RoutePricing's cheapest-bookable-fare shape as-is.
export const v2RoutePricingItemSchema = routePricingResultItemSchema;

// v2 doesn't (yet) expose the `shortLived` testing knob — reserved for v3/v4 (see
// standard/openapi.ts's loginBodySchema).
export const v2LoginBodySchema = omitSchemaFields(loginBodySchema, ['shortLived']);
