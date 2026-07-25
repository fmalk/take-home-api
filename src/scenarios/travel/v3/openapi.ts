import {
  airportSchema,
  airlineSchema,
  flightSchema,
  flightPricingResultItemSchema,
  routePricingResultItemSchema,
  loginBodySchema,
  purchaseBodySchema,
  omitSchemaFields,
} from '../standard/openapi.js';

// v3 is the full-surface version: no field trims on airports/airlines.
export const v3AirportSchema = airportSchema;
export const v3AirlineSchema = airlineSchema;
// v3 hides the flat `price` simplification, same as v2, but keeps every seat class.
export const v3FlightSchema = omitSchemaFields(flightSchema, ['price']);

// v3 is the first version to expose all four seat classes (regular/economy/businessClass/
// firstClass) — no field trim needed, unlike v2's regular-only v2FlightPricingItemSchema.
export const v3FlightPricingItemSchema = flightPricingResultItemSchema;
// v3 routes always show RoutePricing's cheapest-bookable-fare shape as-is, same as v2.
export const v3RoutePricingItemSchema = routePricingResultItemSchema;

// v3 is the first version to expose `shortLived` (see standard/openapi.ts's loginBodySchema),
// so it uses the base schema unmodified.
export const v3LoginBodySchema = loginBodySchema;

// v3 is the first version to sell every seat individually: purchase drops the flat `price` in
// favor of `seats`, one FlightSeatSelection per flight (outbound + inbound) — see
// v3/types.ts's FlightSeatSelection and v3/controller.ts's purchase validation.
const flightSeatSelectionSchema = {
  type: 'object',
  required: ['flightId', 'seatClass', 'currency', 'price'],
  properties: {
    flightId: { type: 'string', description: 'Flight ID this seat selection is for' },
    seatClass: { type: 'string', enum: ['regular', 'economy', 'businessClass', 'firstClass'] },
    currency: { type: 'string', description: 'Code for currency (three letters)' },
    price: { type: 'number', description: 'Agreed price for this flight and seat class' },
  },
};

export const v3PurchaseBodySchema = {
  ...omitSchemaFields(purchaseBodySchema, ['price']),
  required: ['mode', 'outboundId', 'currency', 'seats'],
  properties: {
    ...omitSchemaFields(purchaseBodySchema, ['price']).properties,
    seats: {
      type: 'array',
      description: 'One seat selection per flight across the outbound (and inbound, for RoundTrip) routes',
      items: flightSeatSelectionSchema,
    },
  },
};
