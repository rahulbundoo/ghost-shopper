import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { ArtifactRepository, RunClaim } from '@ghostshopper/application';
import { ARTIFACT_FORMATS, type ArtifactReservation } from '@ghostshopper/domain';
import { artifactReservationSchema, entityIdSchema, validate } from '@ghostshopper/contracts';

export const publicArtifactSelection = {
  id: true,
  shopId: true,
  runId: true,
  attempt: true,
  stepId: true,
  stepPosition: true,
  type: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  status: true,
  errorCode: true,
  createdAt: true,
  expiresAt: true,
} satisfies Prisma.ArtifactSelect;
export class PrismaArtifactRepository implements ArtifactRepository {
  constructor(private readonly db: PrismaClient) {}
  private async lock(tx: Prisma.TransactionClient, claim: RunClaim) {
    const result = await tx.testRun.updateMany({
      where: {
        id: claim.run.id,
        shopId: claim.run.shopId,
        attemptCount: claim.attempt,
        status: 'RUNNING',
        leaseToken: claim.token,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { status: 'RUNNING' },
    });
    return result.count === 1;
  }
  async reserve(claim: RunClaim, input: ArtifactReservation): Promise<boolean> {
    const data = validate(artifactReservationSchema, input);
    const tenant = createHash('sha256').update(claim.run.shopId).digest('hex');
    const expectedKey = `evidence/${tenant}/${claim.run.id}/${claim.attempt}/${data.id}.${ARTIFACT_FORMATS[data.type].extension}`;
    if (data.storageKey !== expectedKey || data.expiresAt <= new Date())
      throw new Error('INVALID_ARTIFACT');
    return this.db.$transaction(async (tx) => {
      if (!(await this.lock(tx, claim))) return false;
      const where = { shopId: claim.run.shopId, runId: claim.run.id, attempt: claim.attempt };
      if ((await tx.artifact.count({ where })) >= 11) throw new Error('ARTIFACT_COUNT_LIMIT');
      const step =
        data.stepPosition === null
          ? null
          : await tx.runStep.findFirst({
              where: { ...where, position: data.stepPosition },
              select: { id: true },
            });
      await tx.artifact.create({
        data: {
          ...where,
          id: data.id,
          type: data.type,
          storageKey: data.storageKey,
          stepId: step?.id ?? null,
          stepPosition: data.stepPosition,
          mimeType: ARTIFACT_FORMATS[data.type].mimeType,
          sizeBytes: data.sizeBytes,
          sha256: data.sha256,
          expiresAt: data.expiresAt,
        },
      });
      await tx.artifactDeletion.create({
        data: { storageKey: data.storageKey, nextAttemptAt: data.expiresAt },
      });
      return true;
    });
  }
  async finish(claim: RunClaim, input: string, ready: boolean): Promise<boolean> {
    const id = validate(entityIdSchema, input);
    return this.db.$transaction(async (tx) => {
      if (!(await this.lock(tx, claim))) return false;
      const result = await tx.artifact.updateMany({
        where: {
          id,
          shopId: claim.run.shopId,
          runId: claim.run.id,
          attempt: claim.attempt,
          status: 'PENDING',
        },
        data: { status: ready ? 'READY' : 'FAILED', errorCode: ready ? null : 'UPLOAD_FAILED' },
      });
      return result.count === 1;
    });
  }
}
