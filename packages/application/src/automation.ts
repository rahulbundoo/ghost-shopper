import type { EmailKind } from '@ghostshopper/domain';
import type { RunLogger } from './run-processing.js';
export interface EmailClaim {
  readonly id: string;
  readonly token: string;
  readonly shopId: string;
  readonly runId: string;
  readonly recipient: string;
  readonly kind: EmailKind;
}
export interface EmailSender {
  send(claim: EmailClaim): Promise<'ACCEPTED' | 'RETRY' | 'REJECTED'>;
}
export interface AutomationStore {
  schedule(): Promise<number>;
  claimEmail(): Promise<EmailClaim | null>;
  finishEmail(claim: EmailClaim, result: 'ACCEPTED' | 'RETRY' | 'REJECTED'): Promise<void>;
}
export async function deliverPendingEmails(
  store: AutomationStore,
  sender: EmailSender,
  log: RunLogger,
  shouldContinue: () => boolean = () => true,
) {
  // Bound each maintenance tick and stop when the provider is unavailable.
  for (let index = 0; index < 10; index++) {
    if (!shouldContinue()) return;
    const claim = await store.claimEmail();
    if (!claim) return;
    let result: 'ACCEPTED' | 'RETRY' | 'REJECTED';
    try {
      result = await sender.send(claim);
    } catch {
      result = 'RETRY';
    }
    await store.finishEmail(claim, result);
    log({
      level: result === 'ACCEPTED' ? 'info' : 'warn',
      event: 'email.delivery',
      shopId: claim.shopId,
      runId: claim.runId,
      code: result,
    });
    if (result === 'RETRY') return;
  }
}
