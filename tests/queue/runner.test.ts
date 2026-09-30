import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  PrismaRunStore,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService, dispatchPendingRuns } from '../../packages/application/src/index.js';
import {
  BullRunPublisher,
  createRunWorker,
  redisConnection,
  RUN_QUEUE,
} from '../../packages/queue/src/index.js';
import { createRunProcessor, pendingJourneyEngine } from '../../apps/runner/src/processor.js';
import type { RunMonitorJob } from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!databaseUrl || !redisUrl)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL must select dedicated test services.');
const suffix = randomUUID();
const shopId = `queue-${suffix}.myshopify.com`;
const prefix = `ghostshopper-test-${suffix}`;
const config = { redisUrl, prefix };
const db = createDatabase(databaseUrl);
const store = new PrismaRunStore(db);
const service = new MonitoringService(createTenantRepositories(db, shopId));
const log = vi.fn();
let retryRunId: string | undefined;
let executionCount = 0;
const publisher = new BullRunPublisher(config, log);
const queue = new Queue(RUN_QUEUE, { prefix, connection: redisConnection(redisUrl) });
queue.on('error', () => {});
const worker = createRunWorker(
  config,
  2,
  createRunProcessor(
    store,
    {
      execute: (run, signal, recordStep) => {
        if (run.id !== retryRunId) return pendingJourneyEngine.execute(run, signal, recordStep);
        executionCount++;
        return executionCount === 1
          ? Promise.reject(new Error('temporary test failure'))
          : Promise.resolve('PASSED');
      },
    },
    log,
    1000,
  ),
  log,
);
beforeAll(async () => {
  await db.$connect();
  await new ShopRepository(db).markInstalled(shopId, '');
  await worker.waitUntilReady();
});
afterAll(async () => {
  await worker.close();
  await publisher.close();
  // Only this suite's random queue namespace and generated tenant are removed.
  await queue.obliterate({ force: true });
  await queue.close();
  try {
    await db.shop.deleteMany({ where: { id: shopId } });
  } finally {
    await db.$disconnect();
  }
});
async function newJob(): Promise<RunMonitorJob> {
  const monitor = await service.createMonitor({
    name: 'Async test',
    productId: 'gid://shopify/Product/1',
    device: 'MOBILE',
  });
  const run = await service.createTestRun({ monitorId: monitor.id });
  return { version: 1, shopId, runId: run.id };
}
async function awaitTerminal(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await db.testRun.findUniqueOrThrow({ where: { id } });
    if (run.status === 'ERROR' || run.status === 'COMPLETED') return run;
    await delay(100);
  }
  throw new Error('Run did not reach terminal state');
}
describe('real Redis + PostgreSQL asynchronous pipeline', () => {
  it('retries a transient execution with BullMQ backoff and completes once', async () => {
    const job = await newJob();
    retryRunId = job.runId;
    await publisher.publish(job);
    const run = await awaitTerminal(job.runId);
    expect(run).toMatchObject({ status: 'COMPLETED', outcome: 'PASSED', attemptCount: 2 });
    expect(executionCount).toBe(2);
  });
  it('delivers web-created runs to the worker and ignores duplicate delivery', async () => {
    const job = await newJob();
    // Queue readiness is established by the worker before producer's fail-fast commands.
    await publisher.publish(job);
    await publisher.publish(job);
    const run = await awaitTerminal(job.runId);
    expect(run).toMatchObject({
      status: 'ERROR',
      errorCode: 'JOURNEY_ENGINE_NOT_IMPLEMENTED',
      attemptCount: 1,
    });
    await publisher.publish(job);
    await delay(300);
    expect((await db.testRun.findUniqueOrThrow({ where: { id: job.runId } })).attemptCount).toBe(1);
  });
  it('recovers the database-to-Redis gap from durable intent', async () => {
    const job = await newJob();
    await dispatchPendingRuns(
      {
        ...store,
        pending: async (limit) =>
          (await store.pending(limit)).filter((pending) => pending.shopId === shopId),
        dispatched: (j) => store.dispatched(j),
        claim: (j, ms) => store.claim(j, ms),
        advance: (c, f, t, o) => store.advance(c, f, t, o),
        fail: (c, code, retry) => store.fail(c, code, retry),
        recordStep: (c, result) => store.recordStep(c, result),
      },
      publisher,
      log,
    );
    expect((await awaitTerminal(job.runId)).attemptCount).toBe(1);
  });
});
