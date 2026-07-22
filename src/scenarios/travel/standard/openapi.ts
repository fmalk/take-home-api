export const citySchema = {
  type: 'object',
  required: ['name', 'country', 'countryCode'],
  properties: {
    name: { type: 'string', description: 'City name' },
    country: { type: 'string', description: 'Country name' },
    countryCode: { type: 'string', description: 'Country code (two letters)' },
  },
};

export const airportSchema = {
  type: 'object',
  required: ['iata', 'name', 'city', 'country', 'countryCode'],
  properties: {
    iata: { type: 'string', description: 'Airport code IATA' },
    icao: { type: 'string', description: 'Airport code ICAO' },
    name: { type: 'string', description: 'Airport name' },
    city: { type: 'string', description: 'City name' },
    country: { type: 'string', description: 'Country name' },
    countryCode: { type: 'string', description: 'Country code (two letters)' },
    localCurrency: { type: 'string', description: 'Local currency code (three letters)' },
    utcOffset: { type: 'number', description: 'UTC offset' },
    lat: { type: 'number', description: 'Latitude of airport' },
    long: { type: 'number', description: 'Longitude of airport' },
    // type of airport is not exposed to API
  },
};

export const airlineSchema = {
  type: 'object',
  required: ['iata', 'icao', 'name', 'country', 'countryCode'],
  properties: {
    iata: { type: 'string', description: 'Airline code IATA' },
    icao: { type: 'string', description: 'Airline code ICAO' },
    name: { type: 'string', description: 'Airline name' },
    country: { type: 'string', description: 'Airline country of origin' },
    countryCode: { type: 'string', description: 'Airline country of origin code (two letters)' },
    // boolean flags about seats are not exposed to API
  },
};

export const flightPricingSchema = {
  type: 'object',
  required: ['currency', 'available'],
  properties: {
    currency: { type: 'string', description: 'Code for currency (three letters)' },
    available: { type: 'number', description: 'Number of seats available for current seat pricing' },
    regular: { type: 'number', optional: true, description: 'Price for Regular seat' },
    economy: { type: 'number', optional: true, description: 'Price for Economy seat' },
    businessClass: { type: 'number', optional: true, description: 'Price for Business Class seat' },
    firstClass: { type: 'number', optional: true, description: 'Price for First Class seat' },
  },
};

export const routePricingSchema = {
  type: 'object',
  required: ['currency', 'available', 'minimum'],
  properties: {
    currency: { type: 'string', description: 'Code for currency (three letters)' },
    available: { type: 'number', description: 'Number of seats available for current seat pricing' },
    minimum: { type: 'number', description: 'Cheapest bookable fare (regular or economy) summed across legs' },
  },
};

export const flightSchema = {
  type: 'object',
  required: ['id', 'flightTimeHours', 'flightDistanceKms', 'departure', 'arrival', 'travelInfo', 'available'],
  properties: {
    id: { type: 'string', description: 'Unique Flight identifier' },
    flightTimeHours: { type: 'number', description: 'Flight time in hours' },
    flightDistanceKms: { type: 'number', description: 'Flight distance in kilometers' },
    departure: {
      timestamp: { type: 'string', description: 'Departure timestamp (YYYY-MM-DD HH:MM UTC+X)' },
      airport: { type: 'string', description: 'Departure airport code IATA' },
    },
    arrival: {
      timestamp: { type: 'string', description: 'Arrival timestamp (YYYY-MM-DD HH:MM UTC+X)' },
      airport: { type: 'string', description: 'Arrival airport code IATA' },
    },
    travelInfo: {
      airline: { type: 'string', description: 'Airline code IATA' },
      aircraft: { type: 'string', description: 'Manufacturer and Model of aircraft' },
      flightNumber: { type: 'string', description: 'Flight Number' },
    },
    available: { type: 'number', description: 'Quantity of available seats' },
    price: { type: 'number', description: 'Price in USD' },
    pricing: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/FlightPricing',
      },
    },
  },
};

export const routeSchema = {
  type: 'object',
  required: ['id', 'flightTimeHours', 'flightDistanceKms', 'departure', 'arrival', 'pricing', 'available'],
  properties: {
    id: { type: 'string', description: 'Unique Flight identifier' },
    flightTimeHours: { type: 'number', description: 'Flight time in hours' },
    flightDistanceKms: { type: 'number', description: 'Flight distance in kilometers' },
    departure: {
      timestamp: { type: 'string', description: 'Departure timestamp (YYYY-MM-DD HH:MM UTC+X)' },
      airport: { type: 'string', description: 'Departure airport code IATA' },
    },
    arrival: {
      timestamp: { type: 'string', description: 'Arrival timestamp (YYYY-MM-DD HH:MM UTC+X)' },
      airport: { type: 'string', description: 'Arrival airport code IATA' },
    },
    flights: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/Flight',
      },
    },
    available: { type: 'number', description: 'Quantity of available seats' },
    price: { type: 'number', description: 'Price in USD' },
    pricing: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/RoutePricing',
      },
    },
  },
};

export const airportsParameters = {
  get: {
    summary: 'List all airports',
    description: 'Get a complete list of all available airports',
    tags: [],
    responses: {
      '200': {
        description: 'Successful airport list retrieval',
      },
    },
  },
};

export const citiesParameters = {
  get: {
    summary: 'List all cities',
    description: 'Get a complete list of all cities with available airports',
    tags: [],
    responses: {
      '200': {
        description: 'Successful cities list retrieval',
      },
    },
  },
};

export const searchFlightsParameters = {
  get: {
    summary: 'Search for flights',
    description: 'Search for available flights between two cities on a specific date',
    tags: [],
    parameters: [
      {
        name: 'from',
        in: 'query',
        description: 'Departure airport code (3 letters IATA)',
        required: true,
        schema: { type: 'string', minLength: 3, maxLength: 3 },
      },
      {
        name: 'to',
        in: 'query',
        description: 'Destination airport code (3 letters IATA)',
        required: true,
        schema: { type: 'string', minLength: 3, maxLength: 3 },
      },
      {
        name: 'mode',
        in: 'query',
        description: 'Optional. Accepts OneWay or RoundTrip (case-insensitive)',
        required: false,
        schema: { type: 'string', enum: ['OneWay', 'RoundTrip'], default: 'OneWay' },
      },
      {
        name: 'departureDate',
        in: 'query',
        description: 'Departure date (YYYY-MM-DD)',
        required: true,
        schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      {
        name: 'returnDate',
        in: 'query',
        description: 'Optional. Return date (YYYY-MM-DD)',
        required: false,
        schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
    ],
    responses: {
      '200': {
        description: 'Successful flights (routes) search',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                mode: { type: 'string', enum: ['OneWay', 'RoundTrip'] },
                outbound: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/Route',
                  },
                },
                inbound: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/Route',
                  },
                },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad request',
      },
    },
  },
};

export const loginParameters = {
  post: {
    summary: 'Log in',
    description: 'Exchange a username/password pair for a bearer access token',
    tags: [],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              username: { type: 'string', minLength: 5, description: 'At least 5 characters' },
              password: { type: 'string', description: "'tr@vel' followed by the first 5 letters of the username" },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Successful login',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                access_token: { type: 'string' },
                token_type: { type: 'string', enum: ['Bearer'] },
                expires_in: { type: 'number' },
              },
            },
          },
        },
      },
      '401': {
        description: 'Invalid username or password',
      },
    },
  },
};

export const userParameters = {
  get: {
    summary: 'Get authenticated user',
    description: 'Retrieve the profile of the user identified by the bearer access token',
    tags: [],
    security: [{ bearerAuth: [] }],
    responses: {
      '200': {
        description: 'Authenticated user profile',
      },
      '401': {
        description: 'Missing or invalid bearer token',
      },
    },
  },
};

export const getFlightParameters = {
  get: {
    summary: 'Get flight details',
    description: 'Retrieve detailed information about a specific flight',
    tags: [],
    parameters: [
      {
        name: 'id',
        in: 'path',
        description: 'Flight ID',
        required: true,
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'Flight details',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Flight',
            },
          },
        },
      },
      '404': {
        description: 'Flight not found',
      },
    },
  },
};

// Fastify route schemas below (querystring/params/response validation).
// These are the base definitions; scenario route files may spread and
// override specific keys when a version needs to deviate.

export const searchFlightsQuerystring = {
  type: 'object',
  required: ['from', 'to', 'departureDate'],
  // v1 only ever does a one-way search — reject mode/returnDate outright rather than
  // silently ignoring them, so a client can't accidentally get round-trip behavior from v1.
  additionalProperties: false,
  properties: {
    from: { type: 'string', minLength: 3, maxLength: 3 },
    to: { type: 'string', minLength: 3, maxLength: 3 },
    departureDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
};

// v2+ additionally accepts `mode` (defaulting to OneWay) and, when mode is RoundTrip, the
// required `returnDate` for the inbound leg.
export const roundTripSearchFlightsQuerystring = {
  ...searchFlightsQuerystring,
  properties: {
    ...searchFlightsQuerystring.properties,
    mode: { type: 'string' },
    returnDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
};

export const flightIdParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
};

// Self-contained (no $ref) shape actually produced by findDirectFlights + groupRoutes/generator.ts, used for the
// search/detail responses so fastify's serializer doesn't strip the real route/flight fields
// down to the old flat `flightResultSchema` shape.
// flightTimeHours is formatted as HH:MM string; flightDistanceKms is integer.
// Shared by every version's flight result shape; version-specific openapi.ts files spread this
// and add whichever pricing representation (flat `price` vs per-class `pricing`) they expose.
export const flightResultCoreProperties = {
  id: { type: 'string' },
  flightTimeHours: { type: 'string', description: 'Flight time in HH:MM format' },
  flightDistanceKms: { type: 'integer' },
  departure: {
    type: 'object',
    properties: {
      timestamp: { type: 'string' },
      airport: { type: 'string' },
    },
  },
  arrival: {
    type: 'object',
    properties: {
      timestamp: { type: 'string' },
      airport: { type: 'string' },
    },
  },
  travelInfo: {
    type: 'object',
    properties: {
      airline: { type: 'string' },
      aircraft: { type: 'string' },
      flightNumber: { type: 'string' },
    },
  },
  available: { type: 'number' },
};

export const flightPricingResultItemSchema = {
  type: 'object',
  properties: {
    currency: { type: 'string' },
    available: { type: 'number' },
    regular: { type: 'number' },
    economy: { type: 'number' },
    businessClass: { type: 'number' },
    firstClass: { type: 'number' },
  },
};

export const routePricingResultItemSchema = {
  type: 'object',
  properties: {
    currency: { type: 'string' },
    available: { type: 'number' },
    minimum: { type: 'number', description: 'Cheapest bookable fare, summed across legs' },
  },
};

const routeResultFlightSchema = {
  type: 'object',
  properties: { ...flightResultCoreProperties, price: { type: 'number' } },
};

const routeResultSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    flightTimeHours: { type: 'string', description: 'Flight time in HH:MM format' },
    flightDistanceKms: { type: 'integer' },
    departure: routeResultFlightSchema.properties.departure,
    arrival: routeResultFlightSchema.properties.arrival,
    flights: {
      type: 'array',
      items: routeResultFlightSchema,
    },
    available: { type: 'number' },
    price: { type: 'number' },
  },
};

export const baseSearchFlightsSchema = {
  querystring: searchFlightsQuerystring,
  response: {
    200: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        departureDate: { type: 'string' },
        id: { type: 'string' },
        mode: { type: 'string', enum: ['OneWay', 'RoundTrip'] },
        outbound: {
          type: 'array',
          items: routeResultSchema,
        },
      },
    },
  },
};

// v1 flight detail schema: formatted times (HH:MM string) and rounded distance (integer)
const flightDetailResponseSchema = {
  type: 'object',
  properties: { ...flightResultCoreProperties, price: { type: 'number' } },
};

export const baseFlightDetailSchema = {
  params: flightIdParams,
  response: {
    200: flightDetailResponseSchema,
  },
};

export const baseListAirportsSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        airports: {
          type: 'array',
          items: airportSchema,
        },
      },
    },
  },
};

export const baseListCitiesSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        cities: {
          type: 'array',
          items: citySchema,
        },
      },
    },
  },
};

// Auth: OAuth-standard `access_token`/`token_type`/`expires_in` field names for the login
// response (per RFC 6749 section 5.1), unlike the rest of this API's camelCase JSON.
export const loginBodySchema = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 5 },
    password: { type: 'string' },
  },
};

export const loginResponseSchema = {
  type: 'object',
  required: ['access_token', 'token_type', 'expires_in'],
  properties: {
    access_token: { type: 'string' },
    token_type: { type: 'string', enum: ['Bearer'] },
    expires_in: { type: 'number' },
  },
};

export const userResponseSchema = {
  type: 'object',
  required: ['id', 'username', 'fullName', 'email', 'phone', 'avatarUrl'],
  properties: {
    id: { type: 'string' },
    username: { type: 'string' },
    fullName: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    avatarUrl: { type: 'string' },
  },
};

export const baseLoginSchema = {
  body: loginBodySchema,
  response: {
    200: loginResponseSchema,
  },
};

export const baseUserSchema = {
  response: {
    200: userResponseSchema,
  },
};

export const travelSchemas = {
  City: citySchema,
  Airport: airportSchema,
  Airline: airlineSchema,
  FlightPricing: flightPricingSchema,
  RoutePricing: routePricingSchema,
  Flight: flightSchema,
  Route: routeSchema,
};

interface ObjectSchema {
  type: string;
  required?: string[];
  properties: Record<string, unknown>;
}

// Drops fields from a base schema's `properties`/`required` for a version override, keeping a
// version's component schema in sync with whatever the base defines. Shared by every version's
// openapi.ts so field trims never silently diverge from the canonical shape.
export function omitSchemaFields<T extends ObjectSchema>(schema: T, fields: string[]): T {
  return {
    ...schema,
    required: schema.required?.filter((key) => !fields.includes(key)),
    properties: Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !fields.includes(key))),
  };
}

// Every version mounts the same four operations under its own path prefix.
export function buildTravelEndpoints(version: string): Record<string, unknown> {
  return {
    [`/api/travel/${version}/cities`]: citiesParameters,
    [`/api/travel/${version}/airports`]: airportsParameters,
    [`/api/travel/${version}/search`]: searchFlightsParameters,
    [`/api/travel/${version}/flights/{id}`]: getFlightParameters,
  };
}

// Login/user aren't part of every version (see travel/v2/routes.ts for which versions mount
// them), so they're built separately rather than folded into buildTravelEndpoints.
export function buildAuthEndpoints(version: string): Record<string, unknown> {
  return {
    [`/api/travel/${version}/login`]: loginParameters,
    [`/api/travel/${version}/user`]: userParameters,
  };
}
