import pino from 'pino';

let logger: pino.Logger | null = null;

const isDevelopment = process.env.NODE_ENV !== 'production';

export function initLogger(level: string = 'info'): pino.Logger {
  const options: pino.LoggerOptions = {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      env: process.env.NODE_ENV || 'development',
    },
  };

  if (isDevelopment) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    };
  }

  logger = pino(options);

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
  const logObj: Record<string, unknown> = {
    reqId: event.reqId,
    flow: event.flow,
    step: event.step,
  };
  if (event.data !== undefined) {
    logObj.data = event.data;
  }
  getLogger().info(logObj, `[${event.flow}] ${event.step}`);
}

export function logRequest(data: {
  reqId: string;
  method: string;
  url: string;
  status: number;
  ms: number;
  scenario?: string;
}): void {
  const logObj: Record<string, unknown> = {
    reqId: data.reqId,
    method: data.method,
    url: data.url,
    status: data.status,
    duration_ms: data.ms,
    type: 'http_request',
  };
  if (data.scenario !== undefined) {
    logObj.scenario = data.scenario;
  }
  getLogger().info(logObj, `${data.method} ${data.url} ${data.status} ${data.ms}ms`);
}

export function logError(error: unknown, context?: Record<string, unknown>): void {
  const logObj: Record<string, unknown> = { ...context };
  if (error instanceof Error) {
    logObj.error = error.message;
    logObj.stack = error.stack;
  } else {
    logObj.error = String(error);
  }
  getLogger().error(logObj);
}
