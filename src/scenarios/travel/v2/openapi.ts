import { airportSchema, airlineSchema, flightSchema, pricingResultItemSchema, omitSchemaFields } from '../standard/openapi.js';

// v2 is the full-surface version: no field trims on airports/airlines.
export const v2AirportSchema = airportSchema;
export const v2AirlineSchema = airlineSchema;
// v2 hides the flat `price` simplification, keeping the per-class `pricing` breakdown.
export const v2FlightSchema = omitSchemaFields(flightSchema, ['price']);

// v2 flights only ever sell the `regular` tier (economy/business/first are reserved for a
// future, more granular version) but still show it in every currency the flight offers.
export const v2FlightPricingItemSchema = omitSchemaFields(pricingResultItemSchema, [
  'economy',
  'businessClass',
  'firstClass',
  'minimum',
]);
// v2 routes only ever show the cheapest bookable fare per currency, not a specific seat class.
export const v2RoutePricingItemSchema = omitSchemaFields(pricingResultItemSchema, [
  'regular',
  'economy',
  'businessClass',
  'firstClass',
]);
