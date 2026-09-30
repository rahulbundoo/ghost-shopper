import { createHash, randomUUID } from 'node:crypto';
import type {
  ArtifactRepository,
  ArtifactStorage,
  EvidenceRecorder,
  RunLogger,
} from '@ghostshopper/application';
import { ARTIFACT_FORMATS } from '@ghostshopper/domain';

export function createEvidenceRecorder(
  repository: ArtifactRepository,
  storage: ArtifactStorage,
  retentionDays: number,
  log: RunLogger,
): EvidenceRecorder {
  return async (claim, evidence) => {
    const id = randomUUID();
    const tenant = createHash('sha256').update(claim.run.shopId).digest('hex');
    const storageKey = `evidence/${tenant}/${claim.run.id}/${claim.attempt}/${id}.${ARTIFACT_FORMATS[evidence.type].extension}`;
    const context = { runId: claim.run.id, shopId: claim.run.shopId, attempt: claim.attempt };
    const reserved = await repository.reserve(claim, {
      id,
      type: evidence.type,
      stepPosition: evidence.stepPosition,
      sizeBytes: evidence.body.byteLength,
      sha256: createHash('sha256').update(evidence.body).digest('hex'),
      storageKey,
      expiresAt: new Date(Date.now() + retentionDays * 86_400_000),
    });
    if (!reserved) throw new Error('ARTIFACT_LEASE_LOST');
    try {
      await storage.put(storageKey, evidence);
    } catch {
      await repository.finish(claim, id, false);
      log({
        ...context,
        level: 'warn',
        event: 'artifact.upload.failed',
        code: 'ARTIFACT_UPLOAD_FAILED',
      });
      throw new Error('ARTIFACT_UPLOAD_FAILED');
    }
    // A failed/ambiguous DB acknowledgement must not delete a possibly committed
    // object. Private orphan objects expire under the bucket lifecycle policy.
    if (!(await repository.finish(claim, id, true))) throw new Error('ARTIFACT_LEASE_LOST');
    log({ ...context, level: 'info', event: 'artifact.ready' });
  };
}
