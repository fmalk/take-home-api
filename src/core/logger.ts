import pino from 'pino';

let logger: pino.Logger | null = null;

export function initLogger(level: string = 'info'): pino.Logger {
  logger = pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    logger = initLogger();
  }
  return logger;
}

export interface FlowEvent {
  reqId: string;
  flow: string;
  step: string;
  data?: unknown;
}

export function logFlow(event: FlowEvent): void {
  getLogger().info(event, `[${event.flow}] ${event.step}`);
}

export function logRequest(data: {
  reqId: string;
  method: string;
  url: string;
  status: number;
  ms: number;
  scenario?: string;
}): void {
  getLogger().info(data, `${data.method} ${data.url} ${data.status} ${data.ms}ms`);
}
