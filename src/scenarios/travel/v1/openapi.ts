import { airportSchema, airlineSchema, flightSchema } from '../standard/openapi.js';

interface ObjectSchema {
  type: string;
  required?: string[];
  properties: Record<string, unknown>;
}

// Drops fields from a base schema's `properties`/`required` for a version
// override, keeping the v1 schema in sync with whatever the base defines.
function omitSchemaFields<T extends ObjectSchema>(schema: T, fields: string[]): T {
  return {
    ...schema,
    required: schema.required?.filter((key) => !fields.includes(key)),
    properties: Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !fields.includes(key))),
  };
}

export const v1AirportSchema = omitSchemaFields(airportSchema, ['icao', 'utcOffset', 'lat', 'long']);
export const v1AirlineSchema = omitSchemaFields(airlineSchema, ['icao']);
export const v1FlightSchema = omitSchemaFields(flightSchema, ['pricing', 'seats']) // TODO: add the flat "price" 
