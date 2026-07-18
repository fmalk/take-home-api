import type { FastifyInstance } from 'fastify';

export interface ApiErrorResponse {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toJSON(): ApiErrorResponse {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export interface Scenario {
  namespace: string;
  register(app: FastifyInstance): Promise<void>;
  openapi(): Record<string, unknown>;
}
