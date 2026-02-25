import { config } from './config';

type LogPayload = Record<string, unknown>;

const LOG_LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
} as const;

function shouldLog(level: keyof typeof LOG_LEVEL_WEIGHT): boolean {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[config.logLevel];
}

function write(level: keyof typeof LOG_LEVEL_WEIGHT, event: string, payload: LogPayload = {}): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload
  };

  const serialized = JSON.stringify(entry);

  if (level === 'error' || level === 'warn') {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export const logger = {
  debug: (event: string, payload?: LogPayload) => write('debug', event, payload),
  info: (event: string, payload?: LogPayload) => write('info', event, payload),
  warn: (event: string, payload?: LogPayload) => write('warn', event, payload),
  error: (event: string, payload?: LogPayload) => write('error', event, payload)
};
