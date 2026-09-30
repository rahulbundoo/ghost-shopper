import { describe, expect, it } from 'vitest';
import { readQueueConfig, readRunnerConfig } from '../../packages/config/src/index.js';
import { redisConnection } from '../../packages/queue/src/index.js';
import { createLogger } from '../../packages/observability/src/index.js';

const env = {
  REDIS_URL: 'redis://127.0.0.1:6379/1',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1/db',
};
describe('queue configuration and logging', () => {
  it('uses bounded runner defaults independently of Shopify credentials', () => {
    expect(readRunnerConfig(env)).toMatchObject({
      concurrency: 2,
      timeoutMs: 120000,
      prefix: 'ghostshopper',
    });
  });
  it.each([
    { REDIS_URL: 'https://example.com' },
    { REDIS_URL: 'redis://localhost/999' },
    { QUEUE_PREFIX: 'bad:prefix' },
    { RUNNER_CONCURRENCY: '0' },
    { RUN_TIMEOUT_MS: '0' },
  ])('rejects invalid config %j', (change) => {
    expect(() => readRunnerConfig({ ...env, ...change })).toThrow();
  });
  it('does not echo credentials in invalid config errors', () => {
    expect(() => readQueueConfig({ REDIS_URL: 'https://user:secret@host' })).toThrow(
      'GhostShopper setup is incomplete',
    );
  });
  it('configures worker retries and producer timeouts with TLS', () => {
    expect(redisConnection('rediss://user:encoded%21@host:6380/2')).toMatchObject({
      host: 'host',
      port: 6380,
      username: 'user',
      password: 'encoded!',
      db: 2,
      tls: {},
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    expect(redisConnection(env.REDIS_URL, true)).toMatchObject({ maxRetriesPerRequest: null });
  });
  it('only serializes allowlisted structured metadata', () => {
    const lines: string[] = [];
    const log = createLogger('runner', (line) => lines.push(line));
    const event = {
      level: 'error' as const,
      event: 'run.failed',
      runId: 'id',
      code: 'JOB_TIMEOUT',
      password: 'secret',
      error: new Error('token'),
    };
    log(event);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      service: 'runner',
      event: 'run.failed',
      code: 'JOB_TIMEOUT',
    });
    expect(lines[0]).not.toContain('secret');
    expect(lines[0]).not.toContain('token');
  });
});
