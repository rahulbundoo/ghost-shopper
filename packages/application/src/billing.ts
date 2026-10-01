import { DomainError, type SubscriptionSnapshot } from '@ghostshopper/domain';
export interface BillingProvider {
  current(): Promise<SubscriptionSnapshot | null>;
  checkout(): Promise<string>;
  cancel(id: string): Promise<void>;
}
export interface BillingRepository {
  sync(snapshot: SubscriptionSnapshot | null, startedAt: Date): Promise<void>;
  reserveCheckout(): Promise<{ token: string | null; url: string | null }>;
  saveCheckout(token: string, url: string): Promise<void>;
  subscriptionId(): Promise<string | null>;
  cancelled(id: string): Promise<void>;
}
export class BillingService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly provider: BillingProvider,
  ) {}
  async refresh() {
    const startedAt = new Date();
    const snapshot = await this.provider.current();
    await this.repository.sync(snapshot, startedAt);
  }
  async checkout() {
    await this.refresh();
    const reservation = await this.repository.reserveCheckout();
    if (reservation.url) return reservation.url;
    if (!reservation.token) throw new DomainError('CONFLICT');
    // Do not retry an ambiguous charge-creation mutation automatically.
    const url = await this.provider.checkout();
    await this.repository.saveCheckout(reservation.token, url);
    return url;
  }
  async cancel() {
    await this.refresh();
    const id = await this.repository.subscriptionId();
    if (!id) throw new DomainError('CONFLICT');
    await this.provider.cancel(id);
    // Fence older reads. Future polling still verifies Shopify's authoritative state.
    await this.repository.cancelled(id);
  }
}
