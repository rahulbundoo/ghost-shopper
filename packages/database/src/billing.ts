import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DomainError,
  runAllowance,
  billingPolicyKey,
  type BillingPolicy,
  type SubscriptionSnapshot,
} from '@ghostshopper/domain';
import { shopDomainSchema } from '@ghostshopper/contracts';

async function lockedSubscription(
  tx: Prisma.TransactionClient,
  shopId: string,
  policy: BillingPolicy,
) {
  const shop = await tx.shop.findUnique({ where: { id: shopId } });
  if (!shop?.installedAt || shop.uninstalledAt) throw new DomainError('SHOP_INACTIVE');
  await tx.subscription.createMany({
    data: [{ shopId, trialEndsAt: new Date(Date.now() + policy.trialDays * 86400000) }],
    skipDuplicates: true,
  });
  await tx.$queryRaw`SELECT "shopId" FROM "Subscription" WHERE "shopId" = ${shopId} FOR UPDATE`;
  return tx.subscription.findUniqueOrThrow({ where: { shopId } });
}

/** Caller creates both the run and usage row before committing this transaction. */
export async function admitRun(
  tx: Prisma.TransactionClient,
  shopId: string,
  policy: BillingPolicy,
) {
  const state = await lockedSubscription(tx, shopId, policy);
  const allowance = runAllowance(state, policy, new Date());
  if (!allowance) return { error: 'BILLING_REQUIRED' as const };
  const used = await tx.usageRecord.count({ where: { shopId, periodKey: allowance.key } });
  if (used >= allowance.limit) return { error: 'RUN_LIMIT_REACHED' as const };
  return { periodKey: allowance.key };
}

export class PrismaBillingRepository {
  readonly shopId: string;
  constructor(
    private readonly db: PrismaClient,
    authenticatedShop: string,
    private readonly policy: BillingPolicy,
  ) {
    this.shopId = shopDomainSchema.parse(authenticatedShop);
  }
  async summary() {
    return this.db.$transaction(async (tx) => {
      const state = await lockedSubscription(tx, this.shopId, this.policy);
      const allowance = runAllowance(state, this.policy, new Date());
      const periodKey =
        allowance?.key ??
        (state.everPaid && state.periodEnd ? `paid:${state.periodEnd.toISOString()}` : 'trial');
      const used = await tx.usageRecord.count({ where: { shopId: this.shopId, periodKey } });
      return {
        status: state.status,
        trialEndsAt: state.trialEndsAt,
        periodEnd: state.periodEnd,
        verifiedAt: state.verifiedAt,
        used,
        limit: allowance?.limit ?? 0,
        eligible: !!allowance && used < allowance.limit,
        canCancel: !!state.providerId,
        policy: this.policy,
      };
    });
  }
  async sync(snapshot: SubscriptionSnapshot | null, startedAt: Date) {
    await this.db.$transaction(async (tx) => {
      const state = await lockedSubscription(tx, this.shopId, this.policy);
      if (state.syncStartedAt && state.syncStartedAt >= startedAt) return;
      await tx.subscription.update({
        where: { shopId: this.shopId },
        data: {
          status: snapshot ? 'ACTIVE' : state.everPaid ? 'INACTIVE' : 'TRIAL',
          providerId: snapshot?.providerId ?? null,
          periodEnd: snapshot?.periodEnd ?? state.periodEnd,
          policyKey: snapshot ? billingPolicyKey(this.policy) : state.policyKey,
          ...(snapshot
            ? { everPaid: true, approvalUrl: null, checkoutToken: null, checkoutExpiresAt: null }
            : {}),
          verifiedAt: new Date(),
          syncStartedAt: startedAt,
          nextSyncAt: new Date(Date.now() + 300000),
        },
      });
    });
  }
  async reserveCheckout() {
    return this.db.$transaction(async (tx) => {
      const state = await lockedSubscription(tx, this.shopId, this.policy);
      if (state.providerId) throw new DomainError('CONFLICT');
      if (state.checkoutExpiresAt && state.checkoutExpiresAt > new Date()) {
        if (state.approvalUrl) return { url: state.approvalUrl, token: null };
        throw new DomainError('CONFLICT');
      }
      const token = randomUUID();
      await tx.subscription.update({
        where: { shopId: this.shopId },
        data: {
          checkoutToken: token,
          checkoutExpiresAt: new Date(Date.now() + 600000),
          approvalUrl: null,
        },
      });
      return { token, url: null };
    });
  }
  async saveCheckout(token: string, approvalUrl: string) {
    const result = await this.db.subscription.updateMany({
      where: {
        shopId: this.shopId,
        checkoutToken: token,
        shop: { installedAt: { not: null }, uninstalledAt: null },
      },
      data: { approvalUrl },
    });
    if (result.count !== 1) throw new DomainError('CONFLICT');
  }
  async subscriptionId() {
    return this.db.$transaction(
      async (tx) => (await lockedSubscription(tx, this.shopId, this.policy)).providerId,
    );
  }
  async cancelled(id: string) {
    await this.db.$transaction(async (tx) => {
      const state = await lockedSubscription(tx, this.shopId, this.policy);
      if (state.providerId !== id) return;
      const now = new Date();
      await tx.subscription.update({
        where: { shopId: this.shopId },
        data: {
          status: 'INACTIVE',
          providerId: null,
          verifiedAt: now,
          syncStartedAt: now,
          approvalUrl: null,
          checkoutToken: null,
          checkoutExpiresAt: null,
        },
      });
    });
  }
}
