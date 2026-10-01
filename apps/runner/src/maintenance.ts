import type { PrismaMaintenance } from '@ghostshopper/database';
import type { RunLogger } from '@ghostshopper/application';
export async function deleteExpiredEvidence(
  store: Pick<PrismaMaintenance, 'claimDeletion' | 'finishDeletion'>,
  storage: { delete(key: string): Promise<void> },
  log: RunLogger,
  shouldContinue: () => boolean,
) {
  for (let count = 0; count < 5 && shouldContinue(); count++) {
    const claim = await store.claimDeletion();
    if (!claim) return;
    let success = false;
    try {
      await storage.delete(claim.key);
      success = true;
    } catch {
      /* Durable bounded backoff below. */
    }
    await store.finishDeletion(claim, success);
    log({
      level: success ? 'info' : 'warn',
      event: success ? 'retention.deleted' : 'retention.failed',
      code: success ? 'OBJECT_DELETED' : 'OBJECT_DELETE_FAILED',
    });
    if (!success) return;
  }
}
