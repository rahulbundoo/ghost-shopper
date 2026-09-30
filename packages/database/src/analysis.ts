import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { AnalysisRepository, RunClaim } from '@ghostshopper/application';
import {
  analyzeTechnicalRun,
  findingIdentity,
  type AnalysisInput,
  type AnalysisResult,
} from '@ghostshopper/domain';
import { analysisInputSchema, validate } from '@ghostshopper/contracts';

export class PrismaAnalysisRepository implements AnalysisRepository {
  constructor(private readonly db: PrismaClient) {}
  async save(claim: RunClaim, input: AnalysisInput): Promise<AnalysisResult | null> {
    const data = validate(analysisInputSchema, input);
    return this.db.$transaction(
      async (tx) => {
        const where = { shopId: claim.run.shopId, runId: claim.run.id, attempt: claim.attempt };
        const locked = await tx.testRun.updateMany({
          where: {
            id: claim.run.id,
            shopId: claim.run.shopId,
            attemptCount: claim.attempt,
            leaseToken: claim.token,
            leaseExpiresAt: { gt: new Date() },
            status: { in: ['RUNNING', 'ANALYZING'] },
          },
          data: { errorCode: null },
        });
        if (locked.count !== 1) return null;
        const existing = await tx.runAnalysis.findUnique({
          where: { shopId_runId_attempt: where },
          include: { findings: true },
        });
        if (existing) return existing;
        // Persisted step facts are authoritative, not a caller's replay of action results.
        const steps = await tx.runStep.findMany({ where, orderBy: { position: 'asc' }, take: 7 });
        const result = analyzeTechnicalRun({ ...data, steps });
        const artifacts = await tx.artifact.findMany({
          where: { ...where, status: 'READY' },
          take: 11,
          orderBy: { createdAt: 'asc' },
        });
        const { findings, ...summary } = result;
        await tx.runAnalysis.create({ data: { ...where, ...summary } });
        if (findings.length)
          await tx.finding.createMany({
            data: findings.map((finding) => ({
              ...where,
              ...finding,
              fingerprint: createHash('sha256')
                .update(findingIdentity(claim.run, finding))
                .digest('hex'),
              stepId: steps.find((step) => step.position === finding.stepPosition)?.id ?? null,
              evidenceArtifactId:
                artifacts.find(
                  (artifact) =>
                    artifact.type === finding.evidenceType &&
                    (finding.evidenceType !== 'SCREENSHOT' ||
                      artifact.stepPosition === finding.stepPosition),
                )?.id ?? null,
            })),
          });
        return result;
      },
      { maxWait: 1000, timeout: 5000 },
    );
  }
}
