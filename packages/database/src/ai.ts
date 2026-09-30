import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiAnalysis as DatabaseAiAnalysis } from '@prisma/client';
import type { AiAnalysisRepository, AiRequestMetadata, RunClaim } from '@ghostshopper/application';
import type { AiAnalysisRecord, AiCompletion } from '@ghostshopper/domain';
import { aiUsageSchema, journeyAnalysisSchema } from '@ghostshopper/contracts';

export function mapAiAnalysis(row: DatabaseAiAnalysis): AiAnalysisRecord {
  return {
    id: row.id,
    shopId: row.shopId,
    runId: row.runId,
    attempt: row.attempt,
    source: 'AI_ANALYSIS',
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    inputHash: row.inputHash,
    requestedAt: row.requestedAt,
    responseAt: row.responseAt,
    latencyMs: row.latencyMs,
    status: row.status,
    evidenceSteps: row.evidenceSteps,
    usage: row.usage === null ? null : aiUsageSchema.parse(row.usage),
    estimatedCostUsd: row.estimatedCostUsd?.toFixed(8) ?? null,
    result: row.result === null ? null : journeyAnalysisSchema.parse(row.result),
    errorCode: row.errorCode,
  };
}
export class PrismaAiAnalysisRepository implements AiAnalysisRepository {
  constructor(private readonly db: PrismaClient) {}
  begin(claim: RunClaim, metadata: AiRequestMetadata): Promise<string | null> {
    return this.db.$transaction(
      async (tx) => {
        const { shopId, id: runId } = claim.run;
        const run = await tx.testRun.findFirst({
          where: {
            id: runId,
            shopId,
            status: 'COMPLETED',
            attemptCount: claim.attempt,
            shop: { installedAt: { not: null }, uninstalledAt: null },
          },
          select: { id: true },
        });
        if (!run) return null;
        const evidence = await tx.artifact.findMany({
          where: {
            shopId,
            runId,
            attempt: claim.attempt,
            status: 'READY',
            type: 'SCREENSHOT',
            stepPosition: { in: [...metadata.evidenceSteps] },
            expiresAt: { gt: new Date() },
          },
          select: { stepPosition: true },
        });
        if (
          !metadata.evidenceSteps.length ||
          metadata.evidenceSteps.some(
            (step) => !evidence.some((item) => item.stepPosition === step),
          )
        )
          return null;
        const id = randomUUID();
        const created = await tx.aiAnalysis.createMany({
          data: [
            {
              id,
              shopId,
              runId,
              attempt: claim.attempt,
              provider: metadata.provider,
              model: metadata.model,
              promptVersion: metadata.promptVersion,
              inputHash: metadata.inputHash,
              requestedAt: metadata.requestedAt,
              evidenceSteps: [...metadata.evidenceSteps],
              pricing: { ...metadata.pricing },
              expiresAt: new Date(Date.now() + 120_000),
            },
          ],
          skipDuplicates: true,
        });
        return created.count === 1 ? id : null;
      },
      { maxWait: 1000, timeout: 5000 },
    );
  }
  async finish(claim: RunClaim, id: string, completion: AiCompletion): Promise<boolean> {
    const result =
      completion.result === null ? null : journeyAnalysisSchema.parse(completion.result);
    const usage = completion.usage === null ? null : aiUsageSchema.parse(completion.usage);
    if (
      (completion.status === 'SUCCEEDED') !== (result !== null) ||
      (completion.status === 'SUCCEEDED' &&
        (!completion.responseAt || completion.errorCode !== null)) ||
      (completion.status === 'FAILED' && !/^AI_[A-Z_]{1,60}$/.test(completion.errorCode ?? ''))
    )
      throw new Error('AI_INVALID_COMPLETION');
    return this.db.$transaction(
      async (tx) => {
        const saved = await tx.aiAnalysis.updateMany({
          where: {
            id,
            shopId: claim.run.shopId,
            runId: claim.run.id,
            attempt: claim.attempt,
            status: 'RUNNING',
            expiresAt: { gt: new Date() },
          },
          data: {
            status: completion.status,
            responseAt: completion.responseAt,
            latencyMs: completion.latencyMs,
            usage: usage ? { ...usage } : Prisma.DbNull,
            result: result ?? Prisma.DbNull,
            estimatedCostUsd: completion.estimatedCostUsd,
            errorCode: completion.errorCode,
          },
        });
        return saved.count === 1;
      },
      { maxWait: 1000, timeout: 5000 },
    );
  }
  async expire(): Promise<void> {
    // An interrupted/unknown request is not replayed: it may already have been billed.
    await this.db.$transaction(
      (tx) =>
        tx.aiAnalysis.updateMany({
          where: { status: 'RUNNING', expiresAt: { lte: new Date() } },
          data: { status: 'FAILED', errorCode: 'AI_INTERRUPTED' },
        }),
      { maxWait: 1000, timeout: 5000 },
    );
  }
}
