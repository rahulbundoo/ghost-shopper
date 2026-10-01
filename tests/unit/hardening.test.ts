import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import { TokenCipher } from '../../packages/shopify/src/token-cipher.js';
import { readHardeningConfig } from '../../packages/config/src/hardening.js';
import { createSentryReporter } from '../../packages/observability/src/sentry.js';
import { PrismaRateLimiter, PrismaMaintenance } from '../../packages/database/src/hardening.js';
import type { PrismaClient } from '../../packages/database/src/index.js';
import { enforceRateLimit, readinessAuthorized } from '../../apps/web/app/hardening.server.js';
import { deleteExpiredEvidence } from '../../apps/runner/src/maintenance.js';
import { EvidenceCollector } from '../../packages/browser/src/evidence.js';

const key = 'a1'.repeat(32);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('encrypted session credentials', () => {
  it('uses randomized authenticated encryption with tenant and token-type binding', () => {
    const cipher = new TokenCipher(key);
    const first = cipher.encrypt('access-secret', 'offline_one:access')!;
    expect(first).not.toContain('access-secret');
    expect(first).not.toBe(cipher.encrypt('access-secret', 'offline_one:access'));
    expect(cipher.decrypt(first, 'offline_one:access')).toBe('access-secret');
    expect(() => cipher.decrypt(first, 'offline_two:access')).toThrow('SESSION_DECRYPTION_FAILED');
    expect(() => cipher.decrypt(first, 'offline_one:refresh')).toThrow('SESSION_DECRYPTION_FAILED');
    expect(() => new TokenCipher('b2'.repeat(32)).decrypt(first, 'offline_one:access')).toThrow(
      'SESSION_DECRYPTION_FAILED',
    );
  });
  it('rejects plaintext and tampering rather than passing ciphertext to Shopify', () => {
    const cipher = new TokenCipher(key);
    expect(() => cipher.decrypt('legacy-access-token', 'binding')).toThrow();
    const encrypted = cipher.encrypt('secret', 'binding')!;
    const parts = encrypted.split(':');
    parts[3] = 'x'.repeat(22);
    expect(() => cipher.decrypt(parts.join(':'), 'binding')).toThrow();
    expect(() => new TokenCipher('short')).toThrow('SESSION_KEY_INVALID');
    expect(cipher.decrypt(undefined, 'binding')).toBeUndefined();
  });
});
const deployed = {
  DEPLOYMENT_ENV: 'staging',
  SESSION_ENCRYPTION_KEY: key,
  READINESS_TOKEN: 'r'.repeat(40),
  SHOPIFY_API_SECRET: 's'.repeat(32),
  S3_SECRET_ACCESS_KEY: 'k'.repeat(32),
  DATABASE_URL: 'postgresql://app:secret@database.example/db?sslmode=verify-full',
  REDIS_URL: 'rediss://:secret@redis.example:6380',
  S3_ENDPOINT: 'https://storage.example',
  BILLING_ENABLED: 'true',
  ARTIFACT_BUCKET_LIFECYCLE_CONFIRMED: 'true',
  RUNNER_ISOLATION_CONFIRMED: 'true',
  BACKUP_RESTORE_VERIFIED: 'true',
  INGRESS_LIMITS_CONFIRMED: 'true',
};
describe('deployment gates', () => {
  it('keeps local defaults and native traces off', () => {
    expect(readHardeningConfig({})).toMatchObject({ environment: 'local', traceEnabled: false });
    expect(() => readHardeningConfig({ NODE_ENV: 'production' })).toThrow(
      'DEPLOYMENT_ENV_REQUIRED',
    );
    expect(readHardeningConfig(deployed).environment).toBe('staging');
  });
  it.each([
    'SESSION_ENCRYPTION_KEY',
    'READINESS_TOKEN',
    'SHOPIFY_API_SECRET',
    'S3_SECRET_ACCESS_KEY',
    'ARTIFACT_BUCKET_LIFECYCLE_CONFIRMED',
    'RUNNER_ISOLATION_CONFIRMED',
    'BACKUP_RESTORE_VERIFIED',
    'INGRESS_LIMITS_CONFIRMED',
    'BILLING_ENABLED',
  ])('requires %s before merchant testing', (name) => {
    expect(() => readHardeningConfig({ ...deployed, [name]: '' })).toThrow();
  });
  it.each([
    { DATABASE_URL: 'postgresql://app:secret@database.example/db' },
    { REDIS_URL: 'redis://:secret@redis.example' },
    { S3_ENDPOINT: 'http://storage.example' },
  ])('requires encrypted infrastructure transport %j', (changes) => {
    expect(() => readHardeningConfig({ ...deployed, ...changes })).toThrow(
      'PRODUCTION_TLS_REQUIRED',
    );
  });
});
describe('shared rate limits and protected readiness', () => {
  it('uses parameterized atomic window counts with hashed keys', async () => {
    const query = vi.fn().mockResolvedValue([{ count: 21 }]);
    const limiter = new PrismaRateLimiter({ $queryRaw: query } as unknown as PrismaClient);
    expect(await limiter.take('tenant.myshopify.com', 'write', 20)).toBe(false);
    expect(JSON.stringify(query.mock.calls)).not.toContain('tenant.myshopify.com');
    expect(String(query.mock.calls[0]?.[0])).toContain('ON CONFLICT');
  });
  it('returns 429 with no-store and retry guidance before performing work', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ count: 21 }]) } as unknown as PrismaClient;
    try {
      await enforceRateLimit(db, 'tenant.myshopify.com', 'write', 20);
      throw new Error('Expected limit');
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('60');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('requires exact readiness bearer bytes and rejects non-ASCII input safely', () => {
    const token = 'r'.repeat(40);
    expect(
      readinessAuthorized(
        new Request('https://app.example/ready', { headers: { Authorization: `Bearer ${token}` } }),
        token,
      ),
    ).toBe(true);
    expect(
      readinessAuthorized(new Request('https://app.example/ready?token=' + token), token),
    ).toBe(false);
    expect(
      readinessAuthorized(
        new Request('https://app.example/ready', {
          headers: { Authorization: `Bearer ${'é'.repeat(40)}` },
        }),
        token,
      ),
    ).toBe(false);
    expect(readinessAuthorized(new Request('https://app.example/ready'), undefined)).toBe(false);
  });
});
describe('bounded privacy maintenance', () => {
  it('fences deletion acknowledgements and backs off failures', async () => {
    const db = { artifactDeletion: { deleteMany: vi.fn(), updateMany: vi.fn() } };
    const store = new PrismaMaintenance(db as unknown as PrismaClient);
    const claim = { key: 'fixture-key', token: 'lease', attempts: 2 };
    await store.finishDeletion(claim, true);
    expect(db.artifactDeletion.deleteMany).toHaveBeenCalledWith({
      where: { storageKey: 'fixture-key', leaseToken: 'lease' },
    });
    await store.finishDeletion(claim, false);
    expect(db.artifactDeletion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaseToken: null,
          lastError: 'OBJECT_DELETE_FAILED',
        }) as unknown,
      }),
    );
  });
  it('does not retry storage in a tight loop or expose keys in logs', async () => {
    const store = {
      claimDeletion: vi.fn().mockResolvedValue({ key: 'private-key', token: 'lease', attempts: 1 }),
      finishDeletion: vi.fn(),
    };
    const storage = { delete: vi.fn().mockRejectedValue(new Error('secret')) };
    const log = vi.fn();
    await deleteExpiredEvidence(store, storage, log, () => true);
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(store.finishDeletion).toHaveBeenCalledWith(expect.anything(), false);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-key');
    storage.delete.mockClear();
    await deleteExpiredEvidence(store, storage, log, () => false);
    expect(storage.delete).not.toHaveBeenCalled();
  });
  it('disabled traces do not become capture failures or start filesystem capture', async () => {
    const tracing = { start: vi.fn(), stop: vi.fn() };
    const context = { tracing, on: vi.fn(), off: vi.fn() } as unknown as BrowserContext;
    const page = { on: vi.fn(), off: vi.fn() } as unknown as Page;
    const sink = vi.fn().mockResolvedValue(undefined);
    const collector = new EvidenceCollector(sink, false);
    await collector.start(context, page);
    await collector.finish();
    expect(tracing.start).not.toHaveBeenCalled();
    expect(tracing.stop).not.toHaveBeenCalled();
    expect(collector.incomplete).toBe(false);
    expect(sink.mock.calls.map((call) => (call[0] as { type: string }).type)).not.toContain(
      'TRACE',
    );
  });
});
describe('optional privacy-preserving Sentry transport', () => {
  const dsn = `https://${'a'.repeat(32)}@o123.ingest.us.sentry.io/42`;
  it('sends only fixed metadata with redirects and retries disabled', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const report = createSentryReporter(dsn, request)!;
    await report({
      service: 'runner',
      event: 'queue.failed',
      code: 'SECRET with spaces and ?token=private',
    });
    const options = request.mock.calls[0]?.[1];
    expect(request.mock.calls[0]?.[0]).toBe('https://o123.ingest.us.sentry.io/api/42/envelope/');
    expect(options?.redirect).toBe('error');
    expect(typeof options?.body).toBe('string');
    expect(options?.body).toContain('REDACTED');
    expect(options?.body).not.toContain('private');
  });
  it('bounds concurrency and swallows provider failures without logging secrets', async () => {
    let rejectRequest!: (reason: Error) => void;
    const waiting = new Promise<Response>((_resolve, reject) => {
      rejectRequest = reject;
    });
    const request = vi.fn<typeof fetch>().mockReturnValue(waiting);
    const report = createSentryReporter(dsn, request)!;
    const first = report({ service: 'web', event: 'failed' });
    const second = report({ service: 'web', event: 'failed' });
    await report({ service: 'web', event: 'failed' });
    expect(request).toHaveBeenCalledTimes(2);
    rejectRequest(new Error('private provider error'));
    await Promise.all([first, second]);
  });
  it.each([
    'http://user@o1.ingest.sentry.io/1',
    'https://user@localhost/1',
    'https://user@evil.example/1',
  ])('rejects unsafe DSN %s', (dsn) => {
    expect(() => createSentryReporter(dsn)).toThrow();
  });
});
