import { describe, expect, it, vi } from 'vitest';
import {
  PrismaAiAnalysisRepository,
  type PrismaClient,
} from '../../packages/database/src/index.js';
import { aiClaim, aiCompletion } from '../fixtures/ai.js';
const metadata = {
  provider: 'openai',
  model: 'configured-model',
  promptVersion: 'journey-analysis-v1',
  inputHash: 'a'.repeat(64),
  requestedAt: new Date(),
  evidenceSteps: [2],
  pricing: { input: 2, cachedInput: 0.5, output: 10 },
};
function fixture() {
  const tx = {
    testRun: { findFirst: vi.fn().mockResolvedValue({ id: aiClaim.run.id }) },
    artifact: { findMany: vi.fn().mockResolvedValue([{ stepPosition: 2 }]) },
    aiAnalysis: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const db = {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    aiAnalysis: tx.aiAnalysis,
  } as unknown as PrismaClient;
  return { tx, repository: new PrismaAiAnalysisRepository(db) };
}
describe('AI reservation and persistence', () => {
  it('requires completed current-attempt run, active tenant and ready evidence', async () => {
    const { repository, tx } = fixture();
    expect(await repository.begin(aiClaim, metadata)).toMatch(/^[a-f0-9-]{36}$/);
    expect(tx.testRun.findFirst).toHaveBeenCalledWith({
      where: {
        id: aiClaim.run.id,
        shopId: aiClaim.run.shopId,
        status: 'COMPLETED',
        attemptCount: 1,
        shop: { installedAt: { not: null }, uninstalledAt: null },
      },
      select: { id: true },
    });
    expect(tx.artifact.findMany).toHaveBeenCalledWith({
      where: {
        shopId: aiClaim.run.shopId,
        runId: aiClaim.run.id,
        attempt: 1,
        status: 'READY',
        type: 'SCREENSHOT',
        stepPosition: { in: [2] },
        expiresAt: { gt: expect.any(Date) as unknown },
      },
      select: { stepPosition: true },
    });
    expect(tx.aiAnalysis.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
  it('does not reserve for absent/inactive/cross-tenant runs, missing evidence or duplicates', async () => {
    const { repository, tx } = fixture();
    tx.testRun.findFirst.mockResolvedValue(null);
    expect(await repository.begin(aiClaim, metadata)).toBeNull();
    expect(tx.aiAnalysis.createMany).not.toHaveBeenCalled();
    tx.testRun.findFirst.mockResolvedValue({ id: aiClaim.run.id });
    tx.artifact.findMany.mockResolvedValue([]);
    expect(await repository.begin(aiClaim, metadata)).toBeNull();
    tx.artifact.findMany.mockResolvedValue([{ stepPosition: 2 }]);
    tx.aiAnalysis.createMany.mockResolvedValue({ count: 0 });
    expect(await repository.begin(aiClaim, metadata)).toBeNull();
  });
  it('fences completion by tenant, attempt, status and deadline, without touching runs/incidents', async () => {
    const { repository, tx } = fixture();
    expect(await repository.finish(aiClaim, 'id', aiCompletion)).toBe(true);
    expect(tx.aiAnalysis.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'id',
          shopId: aiClaim.run.shopId,
          runId: aiClaim.run.id,
          attempt: 1,
          status: 'RUNNING',
          expiresAt: { gt: expect.any(Date) as unknown },
        },
      }),
    );
    tx.aiAnalysis.updateMany.mockResolvedValue({ count: 0 });
    expect(await repository.finish(aiClaim, 'id', aiCompletion)).toBe(false);
  });
  it('rejects unvalidated results before writing and expires interrupted calls without replay', async () => {
    const { repository, tx } = fixture();
    await expect(
      repository.finish(aiClaim, 'id', { ...aiCompletion, result: null }),
    ).rejects.toThrow('AI_INVALID_COMPLETION');
    expect(tx.aiAnalysis.updateMany).not.toHaveBeenCalled();
    await repository.expire();
    expect(tx.aiAnalysis.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'RUNNING',
        expiresAt: { lte: expect.any(Date) as unknown },
      },
      data: { status: 'FAILED', errorCode: 'AI_INTERRUPTED' },
    });
  });
});
