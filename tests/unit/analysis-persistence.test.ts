import { describe, expect, it, vi } from 'vitest';
import { PrismaAnalysisRepository, type PrismaClient } from '../../packages/database/src/index.js';
import type { RunClaim } from '../../packages/application/src/index.js';
const claim = {
  run: {
    id: '57e735d9-220b-4be1-8fda-fda1c7a71ab5',
    shopId: 'test.myshopify.com',
    monitorId: 'monitor',
    scenario: 'PURCHASE_JOURNEY',
    device: 'DESKTOP',
    productId: 'product',
    variantId: null,
  },
  attempt: 1,
  token: 'lease',
} as RunClaim;
const input = {
  steps: [],
  diagnostics: [],
  diagnosticsComplete: false,
  journeyOutcome: 'FAILED' as const,
};
function fixture() {
  const tx = {
    testRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    runAnalysis: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    runStep: { findMany: vi.fn().mockResolvedValue([]) },
    artifact: { findMany: vi.fn().mockResolvedValue([]) },
    finding: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { tx, repo: new PrismaAnalysisRepository(db) };
}
describe('analysis persistence fencing', () => {
  it('requires tenant, run, attempt, active stage and unexpired matching lease', async () => {
    const { tx, repo } = fixture();
    tx.testRun.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.save(claim, input)).toBeNull();
    expect(tx.testRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: claim.run.id,
        shopId: claim.run.shopId,
        attemptCount: 1,
        leaseToken: 'lease',
        leaseExpiresAt: { gt: expect.any(Date) as unknown },
        status: { in: ['RUNNING', 'ANALYZING'] },
      },
      data: { errorCode: null },
    });
    expect(tx.runAnalysis.create).not.toHaveBeenCalled();
    expect(tx.finding.createMany).not.toHaveBeenCalled();
  });
  it('returns an existing immutable attempt without duplicating findings', async () => {
    const { tx, repo } = fixture();
    const saved = { score: 0, outcome: 'FAILED', findings: [] };
    tx.runAnalysis.findUnique.mockResolvedValue(saved);
    expect(await repo.save(claim, input)).toEqual(saved);
    expect(tx.runAnalysis.create).not.toHaveBeenCalled();
  });
  it('uses persisted step facts and links only tenant/attempt scoped evidence', async () => {
    const { tx, repo } = fixture();
    tx.runStep.findMany.mockResolvedValue([
      {
        id: 'step',
        action: 'ADD_TO_CART',
        position: 4,
        status: 'FAILED',
        errorCode: 'ADD_TO_CART_FAILURE',
        durationMs: 1,
      },
    ]);
    tx.artifact.findMany.mockResolvedValue([
      { id: 'artifact', type: 'SCREENSHOT', stepPosition: 4 },
    ]);
    const result = await repo.save(claim, input);
    expect(result).toMatchObject({ score: null, complete: false, outcome: 'FAILED' });
    const insert = tx.finding.createMany.mock.calls[0]?.[0] as { data: object[] };
    expect(insert.data[0]).toMatchObject({
      shopId: claim.run.shopId,
      runId: claim.run.id,
      attempt: 1,
      stepId: 'step',
      evidenceArtifactId: 'artifact',
      type: 'ADD_TO_CART_FAILURE',
      severity: 'CRITICAL',
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
    });
    expect(tx.artifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopId: claim.run.shopId, runId: claim.run.id, attempt: 1, status: 'READY' },
      }),
    );
  });
});
