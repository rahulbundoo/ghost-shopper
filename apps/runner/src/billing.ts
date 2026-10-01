import { BillingService, type RunLogger } from '@ghostshopper/application';
import { PrismaBillingRepository, type PrismaClient } from '@ghostshopper/database';
import type { BillingPolicy } from '@ghostshopper/domain';
import { ShopifyBillingProvider, type ShopifyApplication } from '@ghostshopper/shopify';

export async function refreshBilling(
  db: PrismaClient,
  shopify: ShopifyApplication,
  policy: BillingPolicy,
  appUrl: string,
  log: RunLogger,
  shouldContinue: () => boolean,
) {
  const now = new Date();
  const due = await db.subscription.findMany({
    where: { nextSyncAt: { lte: now }, shop: { installedAt: { not: null }, uninstalledAt: null } },
    orderBy: [{ nextSyncAt: 'asc' }, { shopId: 'asc' }],
    take: 5,
    select: { shopId: true },
  });
  for (const { shopId } of due) {
    if (!shouldContinue()) return;
    const claimed = await db.subscription.updateMany({
      where: { shopId, nextSyncAt: { lte: now } },
      data: { nextSyncAt: new Date(Date.now() + 300000) },
    });
    if (!claimed.count) continue;
    try {
      // Tenant comes exclusively from installed database records, never job/client input.
      const { admin } = await shopify.unauthenticated.admin(shopId);
      await new BillingService(
        new PrismaBillingRepository(db, shopId, policy),
        new ShopifyBillingProvider(shopId, admin.graphql, policy, appUrl),
      ).refresh();
    } catch {
      log({ level: 'warn', event: 'billing.sync.failed', shopId, code: 'BILLING_UNAVAILABLE' });
    }
  }
}
