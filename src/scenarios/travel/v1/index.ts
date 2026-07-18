import type { FastifyInstance } from 'fastify';
import type { Scenario } from '../../../types/index.js';
import { registerRoutes } from './routes.js';

export const travelV1: Scenario = {
    namespace: 'travel/v1',

    async register(app: FastifyInstance): Promise<void> {
        await registerRoutes(app);
    },

    openapi() {
        return {
            '/api/travel/v1/airports': ,
            '/api/travel/v1/cities': {
                get: {
                    summary: 'List all cities',
                    description: 'Get a complete list of all cities with available airports',
                    tags: ['Travel V1'],
                    responses: {
                        '200': {
                            description: 'Successful cities list retrieval',
                        },
                    },
                },
            },
            '/api/travel/v1/flights': {
                get: {
                    summary: 'Search for flights',
                    description: 'Search for available flights between two cities on a specific date',
                    tags: ['Travel V1'],
                    parameters: [
                        {
                            name: 'from',
                            in: 'query',
                            description: 'Departure airport code (3 letters IATA)',
                            required: true,
                            schema: { type: 'string' },
                        },
                        {
                            name: 'to',
                            in: 'query',
                            description: 'Destination airport code (3 letters IATA)',
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
                        },
                    },
                },
            },
        };
    },
};
