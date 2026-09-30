import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  PrismaAnalysisRepository,
  PrismaArtifactRepository,
  PrismaRunStore,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService, type RunClaim } from '../../packages/application/src/index.js';
import { JOURNEY_ACTIONS, type ActionResult } from '../../packages/domain/src/index.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must select a dedicated migrated database.');
const db = createDatabase(url);
const shopId = `analysis-${randomUUID()}.myshopify.com`;
const otherId = `analysis-${randomUUID()}.myshopify.com`;
const shops = new ShopRepository(db);
const service = new MonitoringService(createTenantRepositories(db, shopId));
const other = new MonitoringService(createTenantRepositories(db, otherId));
const runs = new PrismaRunStore(db);
const analyses = new PrismaAnalysisRepository(db);
const artifacts = new PrismaArtifactRepository(db);
let claim: RunClaim;
const steps: ActionResult[] = JOURNEY_ACTIONS.map((action, position) => ({
  action,
  position,
  status: position < 4 ? 'PASSED' : position === 4 ? 'FAILED' : 'SKIPPED',
  startedAt: new Date(0),
  finishedAt: new Date(1),
  durationMs: 1,
  currentUrl: null,
  errorCode: position < 4 ? null : position === 4 ? 'ADD_TO_CART_FAILURE' : 'PREVIOUS_STEP_FAILED',
  errorMessage: position < 4 ? null : 'safe error',
}));
const input = {
  steps,
  diagnostics: [],
  diagnosticsComplete: true,
  journeyOutcome: 'FAILED' as const,
};
beforeAll(async () => {
  await shops.markInstalled(shopId, '');
  await shops.markInstalled(otherId, '');
  const monitor = await service.createMonitor({
    name: 'Analysis',
    productId: 'gid://shopify/Product/1',
    device: 'DESKTOP',
  });
  const run = await service.createTestRun({ monitorId: monitor.id });
  const result = await runs.claim({ version: 1, shopId, runId: run.id }, 300000);
  if (result.kind !== 'claimed') throw new Error('Expected claim');
  claim = result.claim;
  for (const step of steps) await runs.recordStep(claim, step);
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: { in: [shopId, otherId] } } });
  } finally {
    await db.$disconnect();
  }
});
describe('real analysis persistence', () => {
  it('atomically saves one immutable analysis, links evidence and enforces tenancy/lease/constraints', async () => {
    const id = randomUUID();
    await artifacts.reserve(claim, {
      id,
      type: 'SCREENSHOT',
      stepPosition: 4,
      sizeBytes: 8,
      sha256: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 86400000),
      storageKey: `evidence/${createHash('sha256').update(shopId).digest('hex')}/${claim.run.id}/1/${id}.png`,
    });
    await artifacts.finish(claim, id, true);
    expect(await analyses.save({ ...claim, token: randomUUID() }, input)).toBeNull();
    await runs.advance(claim, 'RUNNING', 'COLLECTING');
    await runs.advance(claim, 'COLLECTING', 'ANALYZING');
    const results = await Promise.all([analyses.save(claim, input), analyses.save(claim, input)]);
    expect(results.every((result) => result?.score === 0)).toBe(true);
    const records = await service.listRunAnalyses(claim.run.id);
    expect(records).toHaveLength(1);
    expect(records[0]?.findings).toHaveLength(1);
    const finding = records[0]!.findings[0]!;
    expect(finding).toMatchObject({
      source: 'DETECTED',
      type: 'ADD_TO_CART_FAILURE',
      severity: 'CRITICAL',
      stepPosition: 4,
      evidenceArtifactId: id,
    });
    expect(finding.stepId).not.toBeNull();
    expect(finding.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await other.listRunAnalyses(claim.run.id)).toEqual([]);
    await expect(
      db.finding.update({ where: { id: finding.id }, data: { shopId: otherId } }),
    ).rejects.toThrow();
    await expect(
      db.runAnalysis.update({
        where: { shopId_runId_attempt: { shopId, runId: claim.run.id, attempt: 1 } },
        data: { score: 101 },
      }),
    ).rejects.toThrow();
    await runs.advance(claim, 'ANALYZING', 'COMPLETED', 'FAILED');
    expect(await analyses.save(claim, input)).toBeNull();
    await shops.uninstall(shopId);
    await expect(service.listRunAnalyses(claim.run.id)).rejects.toThrow('SHOP_INACTIVE');
    // Cascading redaction must also work with evidence foreign keys present.
    await shops.redactUninstalledShop(shopId);
    expect(await db.finding.count({ where: { shopId } })).toBe(0);
  });
});
