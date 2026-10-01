import {
  ConfigurationError,
  readShopifyConfig,
  readBillingConfig,
  readHardeningConfig,
  type ShopifyConfig,
} from '@ghostshopper/config';
import { createDatabase, ShopRepository, type PrismaClient } from '@ghostshopper/database';
import {
  createShopifyApplication,
  TenantSessionStorage,
  type ShopifyApplication,
} from '@ghostshopper/shopify';
import { randomUUID } from 'node:crypto';
import { createLogger, createSentryReporter } from '@ghostshopper/observability';

interface ShopifyRuntime {
  config: ShopifyConfig;
  db: PrismaClient;
  shops: ShopRepository;
  shopify: ShopifyApplication;
  billing: ReturnType<typeof readBillingConfig>;
  hardening: ReturnType<typeof readHardeningConfig>;
}
function createRuntime(): ShopifyRuntime {
  const config = readShopifyConfig(process.env);
  const hardening = readHardeningConfig(process.env);
  const db = createDatabase(config.databaseUrl);
  const shops = new ShopRepository(db);
  const shopify = createShopifyApplication(
    config,
    new TenantSessionStorage(db, hardening.sessionKey),
    shops,
  );
  return { config, db, shops, shopify, billing: readBillingConfig(process.env), hardening };
}
let runtime: ShopifyRuntime | undefined;
export function getRuntime(): ShopifyRuntime {
  try {
    return (runtime ??= createRuntime());
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw new Response('GhostShopper setup is incomplete. Contact the app administrator.', {
        status: 503,
      });
    }
    throw error;
  }
}
export function documentHeaders(request: Request, headers: Headers) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Cache-Control', 'no-store');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env['DEPLOYMENT_ENV'] !== undefined && process.env['DEPLOYMENT_ENV'] !== 'local')
    headers.set('Strict-Transport-Security', 'max-age=31536000');
  // Public pages must remain non-frameable even after another request initializes
  // the SDK. Shopify replaces this default for valid embedded document requests.
  headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  if (runtime) runtime.shopify.addDocumentResponseHeaders(request, headers);
}
export function reportFailure(event: string, code: string) {
  const requestId = randomUUID();
  const log = createLogger('web', undefined, reporter());
  log({ level: 'error', event, code, requestId });
  return requestId;
}
let sentry: ReturnType<typeof createSentryReporter>;
let telemetryInitialized = false;
function reporter() {
  if (!telemetryInitialized) {
    telemetryInitialized = true;
    try {
      sentry = createSentryReporter(process.env['SENTRY_DSN']);
    } catch {
      /* No raw DSN in errors. */
    }
  }
  return sentry;
}
export async function withShopifyBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Authentication redirects/challenges must keep Shopify's original response and headers.
    if (error instanceof Response) throw error;
    const requestId = reportFailure('shopify.request.failed', 'SHOPIFY_REQUEST_FAILED');
    throw new Response('The Shopify connection is temporarily unavailable. Please try again.', {
      status: 503,
      headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' },
    });
  }
}
