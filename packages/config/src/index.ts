import { z } from 'zod';

const appUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.hostname.endsWith('.invalid')
  );
}, 'SHOPIFY_APP_URL must be a public HTTPS origin.');

const schema = z.object({
  SHOPIFY_API_KEY: z.string().trim().min(1),
  SHOPIFY_API_SECRET: z.string().trim().min(1),
  SHOPIFY_APP_URL: appUrlSchema,
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        return ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, 'DATABASE_URL must be a PostgreSQL connection URL.'),
});

// Phase 1 reads shop identity only; no product, customer or order scopes are required.
export const SHOPIFY_SCOPES: string[] = [];

export class ConfigurationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super('GhostShopper setup is incomplete. Check the server configuration.');
    this.name = 'ConfigurationError';
  }
}

export function readShopifyConfig(environment: Record<string, string | undefined>) {
  const result = schema.safeParse(environment);
  if (!result.success) {
    throw new ConfigurationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  }
  return {
    apiKey: result.data.SHOPIFY_API_KEY,
    apiSecretKey: result.data.SHOPIFY_API_SECRET,
    appUrl: new URL(result.data.SHOPIFY_APP_URL).origin,
    databaseUrl: result.data.DATABASE_URL,
  };
}
export type ShopifyConfig = ReturnType<typeof readShopifyConfig>;

const aiSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  AI_MODEL: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(20_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(4096).default(2048),
  AI_INPUT_USD_PER_MILLION: z
    .string()
    .trim()
    .min(1)
    .pipe(z.coerce.number<string>().positive().max(1000)),
  AI_CACHED_INPUT_USD_PER_MILLION: z
    .string()
    .trim()
    .min(1)
    .pipe(z.coerce.number<string>().nonnegative().max(1000)),
  AI_OUTPUT_USD_PER_MILLION: z
    .string()
    .trim()
    .min(1)
    .pipe(z.coerce.number<string>().positive().max(1000)),
});
export function readAiConfig(environment: Record<string, string | undefined>) {
  // Even a present key never opts a deployment into external evidence transmission.
  if (environment['AI_ENABLED'] === undefined || environment['AI_ENABLED'] === 'false') return null;
  if (environment['AI_ENABLED'] !== 'true') throw new ConfigurationError(['AI_ENABLED']);
  const parsed = aiSchema.safeParse(environment);
  if (!parsed.success)
    throw new ConfigurationError(parsed.error.issues.map((issue) => String(issue.path[0])));
  const data = parsed.data;
  if (data.AI_CACHED_INPUT_USD_PER_MILLION > data.AI_INPUT_USD_PER_MILLION)
    throw new ConfigurationError(['AI_CACHED_INPUT_USD_PER_MILLION']);
  return {
    apiKey: data.OPENAI_API_KEY,
    model: data.AI_MODEL,
    timeoutMs: data.AI_TIMEOUT_MS,
    maxOutputTokens: data.AI_MAX_OUTPUT_TOKENS,
    pricing: {
      input: data.AI_INPUT_USD_PER_MILLION,
      cachedInput: data.AI_CACHED_INPUT_USD_PER_MILLION,
      output: data.AI_OUTPUT_USD_PER_MILLION,
    },
  };
}

export function isShopifyConfigured(environment: Record<string, string | undefined>): boolean {
  return schema.safeParse(environment).success;
}

const redisUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ['redis:', 'rediss:'].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.search &&
      !url.hash &&
      /^\/(?:\d+)?$/.test(url.pathname || '/') &&
      Number(url.pathname.slice(1) || 0) <= 15
    );
  } catch {
    return false;
  }
});
const queueSchema = z.object({
  REDIS_URL: redisUrlSchema,
  QUEUE_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .default('ghostshopper'),
});
const runnerSchema = queueSchema.extend({
  DATABASE_URL: schema.shape.DATABASE_URL,
  RUNNER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  RUN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(120_000),
  BROWSER_CHANNEL: z.enum(['chromium', 'chrome', 'msedge']).default('chromium'),
  ACTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(10_000),
});
export function readQueueConfig(environment: Record<string, string | undefined>) {
  const result = queueSchema.safeParse(environment);
  if (!result.success)
    throw new ConfigurationError(result.error.issues.map((issue) => String(issue.path[0])));
  return { redisUrl: result.data.REDIS_URL, prefix: result.data.QUEUE_PREFIX };
}
export function readRunnerConfig(environment: Record<string, string | undefined>) {
  const result = runnerSchema.safeParse(environment);
  if (!result.success)
    throw new ConfigurationError(result.error.issues.map((issue) => String(issue.path[0])));
  return {
    ...readQueueConfig(environment),
    databaseUrl: result.data.DATABASE_URL,
    concurrency: result.data.RUNNER_CONCURRENCY,
    timeoutMs: result.data.RUN_TIMEOUT_MS,
    browserChannel: result.data.BROWSER_CHANNEL,
    actionTimeoutMs: result.data.ACTION_TIMEOUT_MS,
  };
}

const storageSchema = z.object({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).max(64),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  ARTIFACT_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
});
export function readStorageConfig(environment: Record<string, string | undefined>) {
  const result = storageSchema.safeParse(environment);
  if (!result.success)
    throw new ConfigurationError(result.error.issues.map((issue) => String(issue.path[0])));
  const data = result.data;
  const url = new URL(data.S3_ENDPOINT);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && local && environment['NODE_ENV'] !== 'production'))
  )
    throw new ConfigurationError(['S3_ENDPOINT']);
  return {
    endpoint: url.origin,
    region: data.S3_REGION,
    bucket: data.S3_BUCKET,
    accessKeyId: data.S3_ACCESS_KEY_ID,
    secretAccessKey: data.S3_SECRET_ACCESS_KEY,
    forcePathStyle: data.S3_FORCE_PATH_STYLE === 'true',
    retentionDays: data.ARTIFACT_RETENTION_DAYS,
  };
}
