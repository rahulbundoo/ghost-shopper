import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  PrismaAiAnalysisRepository,
  PrismaRunStore,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService, type RunClaim } from '../../packages/application/src/index.js';
import { aiCompletion } from '../fixtures/ai.js';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must select a dedicated migrated database.');
const db = createDatabase(url);
const shopId = `ai-${randomUUID()}.myshopify.com`;
const otherId = `ai-${randomUUID()}.myshopify.com`;
const shops = new ShopRepository(db);
const service = new MonitoringService(createTenantRepositories(db, shopId));
const other = new MonitoringService(createTenantRepositories(db, otherId));
const runs = new PrismaRunStore(db);
const repository = new PrismaAiAnalysisRepository(db);
let claim: RunClaim;
const metadata = {
  provider: 'openai',
  model: 'fixture-model',
  promptVersion: 'journey-analysis-v1',
  inputHash: 'a'.repeat(64),
  requestedAt: new Date(),
  evidenceSteps: [2],
  pricing: { input: 2, cachedInput: 0.5, output: 10 },
};
beforeAll(async () => {
  await shops.markInstalled(shopId, '');
  await shops.markInstalled(otherId, '');
  const monitor = await service.createMonitor({
    name: 'AI analysis',
    productId: 'gid://shopify/Product/1',
    device: 'MOBILE',
  });
  const run = await service.createTestRun({ monitorId: monitor.id });
  const result = await runs.claim({ version: 1, shopId, runId: run.id }, 300000);
  if (result.kind !== 'claimed') throw new Error('Expected claim');
  claim = result.claim;
  await db.artifact.create({
    data: {
      id: randomUUID(),
      shopId,
      runId: run.id,
      attempt: 1,
      type: 'SCREENSHOT',
      stepPosition: 2,
      storageKey: `fixture/${randomUUID()}.png`,
      mimeType: 'image/png',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
      status: 'READY',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: { in: [shopId, otherId] } } });
  } finally {
    await db.$disconnect();
  }
});
describe('real AI analysis persistence', () => {
  it('reserves once after completion, protects tenant ownership and stores independent results/cost', async () => {
    expect(await repository.begin(claim, metadata)).toBeNull();
    await runs.advance(claim, 'RUNNING', 'COLLECTING');
    await runs.advance(claim, 'COLLECTING', 'ANALYZING');
    await runs.advance(claim, 'ANALYZING', 'COMPLETED', 'PASSED');
    expect(
      await repository.begin({ ...claim, run: { ...claim.run, shopId: otherId } }, metadata),
    ).toBeNull();
    expect(await repository.begin({ ...claim, attempt: 2 }, metadata)).toBeNull();
    const ids = await Promise.all([
      repository.begin(claim, metadata),
      repository.begin(claim, metadata),
    ]);
    expect(ids.filter(Boolean)).toHaveLength(1);
    const id = ids.find((item) => item !== null)!;
    expect(
      await repository.finish(
        { ...claim, run: { ...claim.run, shopId: otherId } },
        id,
        aiCompletion,
      ),
    ).toBe(false);
    expect(await repository.finish(claim, id, aiCompletion)).toBe(true);
    expect(await repository.finish(claim, id, aiCompletion)).toBe(false);
    expect(await service.listAiAnalyses(claim.run.id)).toMatchObject([
      {
        source: 'AI_ANALYSIS',
        status: 'SUCCEEDED',
        provider: 'openai',
        model: 'fixture-model',
        usage: aiCompletion.usage,
        result: aiCompletion.result,
        estimatedCostUsd: '0.00190000',
      },
    ]);
    expect(await other.listAiAnalyses(claim.run.id)).toEqual([]);
    expect(await service.getTestRun(claim.run.id)).toMatchObject({
      status: 'COMPLETED',
      outcome: 'PASSED',
    });
    expect(await db.incident.count({ where: { shopId } })).toBe(0);
    await expect(
      db.aiAnalysis.update({ where: { id }, data: { shopId: otherId } }),
    ).rejects.toThrow();
    await expect(
      db.aiAnalysis.update({ where: { id }, data: { estimatedCostUsd: '-1' } }),
    ).rejects.toThrow();
    await expect(
      db.aiAnalysis.update({ where: { id }, data: { status: 'FAILED' } }),
    ).rejects.toThrow();
    // Simulate worker death on a separate record with a real unique attempt/run.
    const now = new Date();
    const staleRun = await db.testRun.create({
      data: {
        shopId,
        monitorId: claim.run.monitorId,
        monitorVersion: 1,
        scenario: 'PURCHASE_JOURNEY',
        device: 'MOBILE',
        productId: 'gid://shopify/Product/1',
        status: 'COMPLETED',
        outcome: 'PASSED',
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        attemptCount: 1,
      },
    });
    const stale = await db.aiAnalysis.create({
      data: {
        ...metadata,
        id: randomUUID(),
        shopId,
        runId: staleRun.id,
        attempt: 1,
        expiresAt: new Date(0),
        evidenceSteps: [2],
        pricing: metadata.pricing,
      },
    });
    await repository.expire();
    expect(await db.aiAnalysis.findUnique({ where: { id: stale.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_INTERRUPTED',
      estimatedCostUsd: null,
    });
    expect(
      await repository.finish(
        { ...claim, run: { ...claim.run, id: staleRun.id } },
        stale.id,
        aiCompletion,
      ),
    ).toBe(false);
    await shops.uninstall(shopId);
    expect(await repository.begin(claim, metadata)).toBeNull();
    await expect(service.listAiAnalyses(claim.run.id)).rejects.toThrow('SHOP_INACTIVE');
    await shops.redactUninstalledShop(shopId);
    expect(await db.aiAnalysis.count({ where: { shopId } })).toBe(0);
  });
});
