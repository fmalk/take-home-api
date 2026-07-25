import { FastifyInstance } from 'fastify';
import { registerScenario } from '../core/scenario.js';
import { travelV1 } from './travel/v1/index.js';
import { travelV2 } from './travel/v2/index.js';
import { travelV3 } from './travel/v3/index.js';

export async function registerScenarios(app: FastifyInstance): Promise<void> {
  const scenarios = [travelV1, travelV2, travelV3];

  for (const scenario of scenarios) {
    registerScenario(scenario);
    await scenario.register(app);
  }
}
