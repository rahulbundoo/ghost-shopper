import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  PrismaRunStore,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService } from '../../packages/application/src/index.js';
import type { RunMonitorJob } from '../../packages/contracts/src/index.js';
import type { ActionResult } from '../../packages/domain/src/index.js';

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error('TEST_DATABASE_URL must point to a migrated dedicated PostgreSQL database.');
const db = createDatabase(url);
const shopId = `phase3-${randomUUID()}.myshopify.com`;
const lifecycle = new ShopRepository(db);
const service = new MonitoringService(createTenantRepositories(db, shopId));
const store = new PrismaRunStore(db);
beforeAll(async () => {
  await db.$connect();
  await lifecycle.markInstalled(shopId, '');
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: shopId } });
  } finally {
    await db.$disconnect();
  }
});
async function newJob(): Promise<RunMonitorJob> {
  const monitor = await service.createMonitor({
    name: 'Queue test',
    productId: 'gid://shopify/Product/1',
    device: 'DESKTOP',
  });
  const run = await service.createTestRun({ monitorId: monitor.id });
  return { version: 1, shopId, runId: run.id };
}
describe('PostgreSQL run ownership and dispatch', () => {
  it('persists steps idempotently with tenant isolation and lease fencing', async () => {
    const job = await newJob();
    const result = await store.claim(job, 30000);
    if (result.kind !== 'claimed') throw new Error('Expected claim');
    const step: ActionResult = {
      action: 'OPEN_HOME',
      position: 0,
      status: 'PASSED',
      startedAt: new Date(0),
      finishedAt: new Date(5),
      durationMs: 5,
      currentUrl: 'https://shop.example/',
      errorCode: null,
      errorMessage: null,
    };
    expect(await store.recordStep(result.claim, step)).toBe(true);
    expect(await store.recordStep(result.claim, step)).toBe(true);
    expect(await service.listRunSteps(job.runId)).toHaveLength(1);
    expect(await store.recordStep({ ...result.claim, token: randomUUID() }, step)).toBe(false);
    const other = `other-${randomUUID()}.myshopify.com`;
    await lifecycle.markInstalled(other, '');
    try {
      const otherService = new MonitoringService(createTenantRepositories(db, other));
      expect(await otherService.listRunSteps(job.runId)).toEqual([]);
      await expect(
        db.runStep.create({ data: { ...step, shopId: other, runId: job.runId, attempt: 1 } }),
      ).rejects.toThrow();
    } finally {
      await db.shop.delete({ where: { id: other } });
    }
    await store.fail(result.claim, 'EXECUTION_FAILED', false);
    expect(
      await store.recordStep(result.claim, { ...step, action: 'FIND_PRODUCT', position: 1 }),
    ).toBe(false);
  });
  it('persists dispatch intent atomically and hides ownership data from API reads', async () => {
    const job = await newJob();
    expect(
      (await db.testRun.findUniqueOrThrow({ where: { id: job.runId } })).dispatchRequested,
    ).toBe(true);
    expect(await service.getTestRun(job.runId)).not.toHaveProperty('leaseToken');
    expect(await service.getTestRun(job.runId)).not.toHaveProperty('dispatchRequested');
  });
  it('permits one concurrent claimant and no terminal re-execution', async () => {
    const job = await newJob();
    const results = await Promise.allSettled([store.claim(job, 30000), store.claim(job, 30000)]);
    const winners = results.flatMap((r) =>
      r.status === 'fulfilled' && r.value.kind === 'claimed' ? [r.value.claim] : [],
    );
    expect(winners).toHaveLength(1);
    expect((await store.claim(job, 30000)).kind).toBe('busy');
    expect(await store.fail(winners[0]!, 'JOURNEY_ENGINE_NOT_IMPLEMENTED', false)).toBe(true);
    expect((await store.claim(job, 30000)).kind).toBe('ignored');
    const run = await db.testRun.findUniqueOrThrow({ where: { id: job.runId } });
    expect(run).toMatchObject({ status: 'ERROR', attemptCount: 1, leaseToken: null });
  });
  it('recovers expired ownership and fences late writes', async () => {
    const job = await newJob();
    const first = await store.claim(job, 30000);
    if (first.kind !== 'claimed') throw new Error('Expected claim');
    await db.testRun.update({
      where: { id: job.runId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const second = await store.claim(job, 30000);
    if (second.kind !== 'claimed') throw new Error('Expected recovered claim');
    expect(second.claim.token).not.toBe(first.claim.token);
    expect(second.claim.attempt).toBe(2);
    expect(await store.advance(first.claim, 'RUNNING', 'COLLECTING')).toBe(false);
    expect(await store.fail(first.claim, 'EXECUTION_FAILED', true)).toBe(false);
    expect(await store.advance(second.claim, 'RUNNING', 'COLLECTING')).toBe(true);
    expect(await store.advance(second.claim, 'COLLECTING', 'ANALYZING')).toBe(true);
    expect(await store.advance(second.claim, 'ANALYZING', 'COMPLETED', 'PASSED')).toBe(true);
  });
  it('enforces the attempt budget across deliveries and rejects forged tenants', async () => {
    const job = await newJob();
    expect((await store.claim({ ...job, shopId: 'other.myshopify.com' }, 30000)).kind).toBe(
      'ignored',
    );
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await store.claim(job, 30000);
      if (claimed.kind !== 'claimed') throw new Error('Expected claim');
      expect(claimed.claim.attempt).toBe(attempt);
      await store.fail(claimed.claim, 'EXECUTION_FAILED', true);
    }
    expect((await store.claim(job, 30000)).kind).toBe('ignored');
    expect((await service.getTestRun(job.runId))?.status).toBe('ERROR');
  });
  it('leaves old non-dispatchable runs inert and cancels disabled monitors', async () => {
    const job = await newJob();
    await db.testRun.update({ where: { id: job.runId }, data: { dispatchRequested: false } });
    expect((await store.claim(job, 30000)).kind).toBe('ignored');
    const disabled = await newJob();
    const run = await service.getTestRun(disabled.runId);
    await service.updateMonitor(run!.monitorId, { version: 1, enabled: false });
    expect((await store.claim(disabled, 30000)).kind).toBe('ignored');
    expect((await service.getTestRun(disabled.runId))?.status).toBe('CANCELLED');
  });
  it('uninstall revokes in-flight ownership', async () => {
    const job = await newJob();
    const claimed = await store.claim(job, 30000);
    if (claimed.kind !== 'claimed') throw new Error('Expected claim');
    await lifecycle.uninstall(shopId);
    expect(await store.advance(claimed.claim, 'RUNNING', 'COLLECTING')).toBe(false);
    expect((await db.testRun.findUniqueOrThrow({ where: { id: job.runId } })).status).toBe(
      'CANCELLED',
    );
  });
});
