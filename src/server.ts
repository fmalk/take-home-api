import Fastify, { FastifyInstance, FastifyRequest, LogController } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import { randomUUID } from 'crypto';
import { getLogger, logRequest } from './core/logger.js';
import { ApiError } from './types.js';
import { getRegisteredScenarios } from './core/scenario.js';

declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    logController: new LogController({
      requestIdLogLabel: 'reqId',
      disableRequestLogging: true,
    }),
    genReqId: () => randomUUID(),
  });

  await app.register(fastifyCors, {
    origin: true,
  });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'take-home-api',
        description: 'A ready-made, well-designed REST API mimicking many real world scenarios',
        version: '0.1.0', // TODO: load from package.json
      },
    },
  });

  app.addHook('onRequest', async (request: FastifyRequest) => {
    request.startTime = Date.now();
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply) => {
    const ms = Date.now() - (request.startTime || 0);
    logRequest({
      reqId: request.id,
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      ms,
    });
  });

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  const scenarios = getRegisteredScenarios();
  for (const scenario of scenarios) {
    await scenario.register(app);
  }

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof ApiError) {
      reply.status(error.status).send(error.toJSON());
    } else if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number') {
      reply.status(error.statusCode).send({
        status: error.statusCode,
        code: 'VALIDATION_ERROR',
        message: error.message || 'Validation failed',
      });
    } else {
      getLogger().error(error);
      reply.status(500).send({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    }
  });

  return app;
}
