import { FastifyInstance } from 'fastify';
import { registerScenario } from '../core/scenario.js';
import { travelV1 } from './travel/v1/index.js';

export async function registerScenarios(app: FastifyInstance): Promise<void> {
  registerScenario(travelV1);

  const scenarios = [travelV1];

  for (const scenario of scenarios) {
    await scenario.register(app);
  }
}
