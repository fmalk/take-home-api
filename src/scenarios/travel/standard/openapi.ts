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
    // boolean flags about seats are not exposed at Schema
  },
};

export const pricingSchema = {
  type: 'object',
  required: ['currency'],
  properties: {
    currency: { type: 'string', description: 'Code for currency (three letters)' },
    regular: { type: 'number', description: 'Price for Regular seat' },
    economy: { type: 'number', description: 'Price for Economy seat' },
    businessClass: { type: 'number', description: 'Price for Business Class seat' },
    firstClass: { type: 'number', description: 'Price for First Class seat' },
  },
};

export const seatsSchema = {
  type: 'object',
  required: [],
  properties: {
    regular: { type: 'number', description: 'Available Regular seats' },
    economy: { type: 'number', description: 'Available Economy seats' },
    businessClass: { type: 'number', description: 'Available Business Class seats' },
    firstClass: { type: 'number', description: 'Available First Class seats' },
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
      plane: { type: 'string', description: 'Manufacturer and Model of plane' },
      flightNumber: { type: 'string', description: 'Flight Number' },
    },
    price: { type: 'number', description: 'Price in USD' },
    pricing: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/Pricing',
      },
    },
    available: { type: 'number', description: 'Quantity of available seats' },
    seats: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/Seats',
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
    price: { type: 'number', description: 'Price in USD' },
    pricing: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/Pricing',
      },
    },
    available: { type: 'number', description: 'Quantity of available seats' },
    flights: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/Flight',
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
        name: 'date',
        in: 'query',
        description: 'Departure date (YYYY-MM-DD)',
        required: true,
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
                routes: {
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
  required: ['from', 'to', 'date'],
  properties: {
    from: { type: 'string', minLength: 3, maxLength: 3 },
    to: { type: 'string', minLength: 3, maxLength: 3 },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
};

export const flightIdParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
};

// Flat shape actually produced by the (outdated) flight generator, kept
// separate from `flightSchema` until the generator is updated to match it.
export const flightResultSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    date: { type: 'string' },
    departure: { type: 'string' },
    arrival: { type: 'string' },
    airline: { type: 'string' },
    flightNumber: { type: 'string' },
    price: { type: 'number' },
    available: { type: 'number' },
  },
};

// Self-contained (no $ref) shape actually produced by findRoutes/generator.ts, used for the
// search response so fastify's serializer doesn't strip the real route/flight fields down to
// the old flat `flightResultSchema` shape.
const routeResultFlightSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    flightTimeHours: { type: 'number' },
    flightDistanceKms: { type: 'number' },
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
        plane: { type: 'string' },
        flightNumber: { type: 'string' },
      },
    },
    price: { type: 'number' },
    available: { type: 'number' },
  },
};

const routeResultSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    flightTimeHours: { type: 'number' },
    flightDistanceKms: { type: 'number' },
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
        date: { type: 'string' },
        routes: {
          type: 'array',
          items: routeResultSchema,
        },
      },
    },
  },
};

export const baseFlightDetailSchema = {
  params: flightIdParams,
  response: {
    200: flightResultSchema,
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

export const travelSchemas = {
  City: citySchema,
  Airport: airportSchema,
  Airline: airlineSchema,
  Pricing: pricingSchema,
  Seats: seatsSchema,
  Flight: flightSchema,
  Route: routeSchema,
};

export const travelEndpoints = {
  '/api/travel/v1/cities': citiesParameters,
  '/api/travel/v1/airports': airportsParameters,
  '/api/travel/v1/search': searchFlightsParameters,
  '/api/travel/v1/flights/{id}': getFlightParameters,
};
