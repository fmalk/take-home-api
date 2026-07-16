export function getTravelV1OpenAPI(): Record<string, unknown> {
    return {
        '/api/travel/v1/flights': {
            get: {
                summary: 'Search for flights',
                description: 'Search for available flights between two cities on a specific date',
                tags: ['Travel V1'],
                parameters: [
                    {
                        name: 'from',
                        in: 'query',
                        description: 'Departure city code (3 letters)',
                        required: true,
                        schema: { type: 'string' },
                    },
                    {
                        name: 'to',
                        in: 'query',
                        description: 'Destination city code (3 letters)',
                        required: true,
                        schema: { type: 'string' },
                    },
                    {
                        name: 'date',
                        in: 'query',
                        description: 'Departure date (YYYY-MM-DD)',
                        required: true,
                        schema: { type: 'string' },
                    },
                ],
                responses: {
                    '200': {
                        description: 'Successful flight search',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        from: { type: 'string' },
                                        to: { type: 'string' },
                                        date: { type: 'string' },
                                        flights: {
                                            type: 'array',
                                            items: {
                                                $ref: '#/components/schemas/Flight',
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
        },
        '/api/travel/v1/flights/{id}': {
            get: {
                summary: 'Get flight details',
                description: 'Retrieve detailed information about a specific flight',
                tags: ['Travel V1'],
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
        },
    };
}

export function getTravelV1Schemas(): Record<string, unknown> {
    return {
        Flight: {
            type: 'object',
            required: ['id', 'from', 'to', 'date', 'departure', 'arrival', 'airline', 'flightNumber', 'price', 'available'],
            properties: {
                id: { type: 'string', description: 'Unique flight identifier' },
                from: { type: 'string', description: 'Departure city code' },
                to: { type: 'string', description: 'Destination city code' },
                date: { type: 'string', description: 'Departure date' },
                departure: { type: 'string', description: 'Departure time (HH:MM)' },
                arrival: { type: 'string', description: 'Arrival time (HH:MM)' },
                airline: { type: 'string', description: 'Airline name' },
                flightNumber: { type: 'string', description: 'Flight number' },
                price: { type: 'number', description: 'Price in USD' },
                available: { type: 'number', description: 'Number of available seats' },
            },
        },
    };
}
