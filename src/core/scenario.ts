import type { Scenario } from '../types.js';

const registeredScenarios: Scenario[] = [];

export function registerScenario(scenario: Scenario): void {
  registeredScenarios.push(scenario);
}

export function getRegisteredScenarios(): Scenario[] {
  return registeredScenarios;
}
