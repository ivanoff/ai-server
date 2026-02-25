import { type CorsOptions } from 'cors';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export type GpuBackend = 'auto' | 'cpu' | 'cuda' | 'vulkan' | 'metal';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function parseIntegerEnv(name: string, fallback: number, options?: { min?: number; max?: number }): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }

  if (options?.min !== undefined && parsed < options.min) {
    throw new Error(`Environment variable ${name} must be >= ${options.min}`);
  }

  if (options?.max !== undefined && parsed > options.max) {
    throw new Error(`Environment variable ${name} must be <= ${options.max}`);
  }

  return parsed;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === '') {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Environment variable ${name} must be a boolean (true/false)`);
}

function parseGpuBackend(): GpuBackend {
  const rawValue = process.env.GPU_BACKEND?.trim().toLowerCase();

  if (!rawValue || rawValue === 'auto') {
    return 'auto';
  }

  if (rawValue === 'cpu') {
    return 'cpu';
  }

  if (rawValue === 'cuda' || rawValue === 'vulkan' || rawValue === 'metal') {
    return rawValue;
  }

  throw new Error('Environment variable GPU_BACKEND must be one of: auto, cpu, cuda, vulkan, metal');
}

function parseLogLevel(): LogLevel {
  const rawValue = process.env.LOG_LEVEL?.trim().toLowerCase();

  if (!rawValue) {
    return 'info';
  }

  if (rawValue === 'debug' || rawValue === 'info' || rawValue === 'warn' || rawValue === 'error') {
    return rawValue;
  }

  throw new Error('Environment variable LOG_LEVEL must be one of: debug, info, warn, error');
}

function parseCorsOrigin(): CorsOptions['origin'] {
  const rawValue = process.env.CORS_ORIGIN?.trim();

  if (!rawValue || rawValue === '*') {
    return true;
  }

  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (values.length === 0) {
    return true;
  }

  if (values.length === 1) {
    return values[0];
  }

  return values;
}

function resolveModelPath(modelPathRaw: string | undefined): string {
  const defaultPath = './models/llama-2-7b-chat.gguf';
  const resolved = modelPathRaw?.trim() || defaultPath;

  if (path.isAbsolute(resolved)) {
    return resolved;
  }

  return path.resolve(process.cwd(), resolved);
}

export const config = {
  port: parseIntegerEnv('PORT', 3000, { min: 1, max: 65535 }),
  modelPath: resolveModelPath(process.env.MODEL_PATH),
  modelId: process.env.MODEL_ID?.trim() || 'llama-local',
  defaultMaxTokens: parseIntegerEnv('DEFAULT_MAX_TOKENS', 2048, { min: 1, max: 32768 }),
  gpuLayers: parseIntegerEnv('GPU_LAYERS', 0, { min: 0, max: 1024 }),
  gpuBackend: parseGpuBackend(),
  apiKey: process.env.API_KEY?.trim() || '',
  requestTimeoutMs: parseIntegerEnv('REQUEST_TIMEOUT_MS', 120000, { min: 1000, max: 600000 }),
  maxConcurrentRequests: parseIntegerEnv('MAX_CONCURRENT_REQUESTS', 2, { min: 1, max: 1000 }),
  bodyLimit: process.env.BODY_LIMIT?.trim() || '1mb',
  corsEnabled: parseBooleanEnv('CORS_ENABLED', true),
  corsOrigin: parseCorsOrigin(),
  corsCredentials: parseBooleanEnv('CORS_CREDENTIALS', false),
  trustProxy: parseBooleanEnv('TRUST_PROXY', false),
  securityHeadersEnabled: parseBooleanEnv('SECURITY_HEADERS_ENABLED', true),
  exposeModelPathInHealth: parseBooleanEnv('EXPOSE_MODEL_PATH_IN_HEALTH', false),
  logLevel: parseLogLevel()
} as const;

export function getLlamaGpuOption(): { gpu?: false | 'cuda' | 'vulkan' | 'metal' } {
  if (config.gpuBackend === 'auto') {
    return {};
  }

  if (config.gpuBackend === 'cpu') {
    return { gpu: false };
  }

  return { gpu: config.gpuBackend };
}

export const corsOptions: CorsOptions = {
  origin: config.corsOrigin,
  credentials: config.corsCredentials
};
