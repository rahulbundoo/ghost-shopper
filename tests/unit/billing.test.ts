import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runAllowance,
  billingPolicyKey,
  type BillingPolicy,
} from '../../packages/domain/src/index.js';
import { readBillingConfig } from '../../packages/config/src/index.js';
import { BillingService } from '../../packages/application/src/billing.js';
import {
  ShopifyBillingProvider,
  safeApprovalUrl,
  type BillingGraphql,
} from '../../packages/shopify/src/billing.js';
import { admitRun, PrismaBillingRepository } from '../../packages/database/src/billing.js';
import type { PrismaClient } from '../../packages/database/src/index.js';
import type { Prisma } from '../../packages/database/src/index.js';
const policy: BillingPolicy = {
  priceUsd: '19.00',
  paidRunLimit: 1000,
  trialDays: 14,
  trialRunLimit: 100,
  test: true,
};
const shop = 'billing.myshopify.com';
const now = new Date('2026-09-30T12:00:00Z');
const future = new Date('2026-10-14T12:00:00Z');
const trial = {
  status: 'TRIAL',
  trialEndsAt: future,
  everPaid: false,
  periodEnd: null,
  verifiedAt: null,
  policyKey: null,
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('billing policy', () => {
  it('defaults disabled and requires explicit price/limit with test charges by default', () => {
    expect(readBillingConfig({})).toBeNull();
    expect(() => readBillingConfig({ BILLING_ENABLED: 'yes' })).toThrow();
    expect(() => readBillingConfig({ BILLING_ENABLED: 'true' })).toThrow();
    expect(
      readBillingConfig({
        BILLING_ENABLED: 'true',
        BILLING_PRICE_USD: '19.00',
        BILLING_PAID_RUN_LIMIT: '1000',
      }),
    ).toEqual(policy);
  });
  it.each(['0.00', '-1.00', '1e2', '19', 'Infinity'])('rejects invalid price %s', (price) => {
    expect(() =>
      readBillingConfig({
        BILLING_ENABLED: 'true',
        BILLING_PRICE_USD: price,
        BILLING_PAID_RUN_LIMIT: '1000',
      }),
    ).toThrow();
  });
  it('expires trial at the exact boundary and never restores trial after payment', () => {
    expect(runAllowance(trial, policy, now)).toMatchObject({ key: 'trial', limit: 100 });
    expect(runAllowance(trial, policy, future)).toBeNull();
    expect(runAllowance({ ...trial, everPaid: true }, policy, now)).toBeNull();
  });
  it('requires active, current, freshly verified, matching paid policy', () => {
    const active = {
      ...trial,
      status: 'ACTIVE',
      everPaid: true,
      periodEnd: future,
      verifiedAt: now,
      policyKey: billingPolicyKey(policy),
    };
    expect(runAllowance(active, policy, now)).toMatchObject({
      key: `paid:${future.toISOString()}`,
      limit: 1000,
    });
    expect(runAllowance(active, policy, future)).toBeNull();
    expect(
      runAllowance({ ...active, verifiedAt: new Date(now.getTime() - 3600000) }, policy, now),
    ).toBeNull();
    expect(runAllowance({ ...active, status: 'INACTIVE' }, policy, now)).toBeNull();
    expect(runAllowance(active, { ...policy, test: false }, now)).toBeNull();
  });
});
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const tx = {
    shop: { findUnique: vi.fn().mockResolvedValue({ installedAt: now, uninstalledAt: null }) },
    $queryRaw: vi.fn().mockResolvedValue([{ shopId: shop }]),
    subscription: {
      createMany: vi.fn(),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ ...trial, providerId: null, syncStartedAt: null }),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    usageRecord: { count: vi.fn().mockResolvedValue(99) },
  };
  const db = {
    ...tx,
    $transaction: vi.fn((op: (client: typeof tx) => Promise<unknown>) => op(tx)),
  };
  return {
    tx,
    client: tx as unknown as Prisma.TransactionClient,
    repository: new PrismaBillingRepository(db as unknown as PrismaClient, shop, policy),
  };
}
describe('atomic usage admission and subscription state', () => {
  it('locks the subscription before counting tenant usage and rejects at the limit', async () => {
    const f = fixture();
    expect(await admitRun(f.client, shop, policy)).toEqual({ periodKey: 'trial' });
    expect(f.tx.usageRecord.count).toHaveBeenCalledWith({
      where: { shopId: shop, periodKey: 'trial' },
    });
    expect(String(f.tx.$queryRaw.mock.calls[0]?.[0])).toContain('FOR UPDATE');
    f.tx.usageRecord.count.mockResolvedValue(100);
    expect(await admitRun(f.client, shop, policy)).toEqual({ error: 'RUN_LIMIT_REACHED' });
  });
  it('blocks inactive shops and expired trials', async () => {
    const f = fixture();
    f.tx.subscription.findUniqueOrThrow.mockResolvedValue({ ...trial, trialEndsAt: now });
    expect(await admitRun(f.client, shop, policy)).toEqual({ error: 'BILLING_REQUIRED' });
    f.tx.shop.findUnique.mockResolvedValue({ installedAt: now, uninstalledAt: now });
    await expect(admitRun(f.client, shop, policy)).rejects.toThrow('SHOP_INACTIVE');
  });
  it('ignores stale reconciliation and snapshots paid policy on activation', async () => {
    const f = fixture();
    f.tx.subscription.findUniqueOrThrow.mockResolvedValue({ ...trial, syncStartedAt: now });
    await f.repository.sync(null, new Date(now.getTime() - 1));
    expect(f.tx.subscription.update).not.toHaveBeenCalled();
    await f.repository.sync(
      { providerId: 'gid://shopify/AppSubscription/1', periodEnd: future },
      new Date(now.getTime() + 1),
    );
    expect(f.tx.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ACTIVE',
          everPaid: true,
          policyKey: billingPolicyKey(policy),
        }) as unknown,
      }),
    );
  });
  it('reuses pending confirmation links and blocks simultaneous charge creation', async () => {
    const f = fixture();
    f.tx.subscription.findUniqueOrThrow.mockResolvedValue({
      ...trial,
      checkoutExpiresAt: future,
      approvalUrl: 'https://admin.shopify.com/confirm',
    });
    expect(await f.repository.reserveCheckout()).toEqual({
      token: null,
      url: 'https://admin.shopify.com/confirm',
    });
    f.tx.subscription.findUniqueOrThrow.mockResolvedValue({
      ...trial,
      checkoutExpiresAt: future,
      approvalUrl: null,
    });
    await expect(f.repository.reserveCheckout()).rejects.toThrow('CONFLICT');
  });
  it('confirms cancellation even within the last sync millisecond without revoking a replacement', async () => {
    const f = fixture();
    f.tx.subscription.findUniqueOrThrow.mockResolvedValue({
      ...trial,
      providerId: 'old',
      syncStartedAt: now,
    });
    await f.repository.cancelled('old');
    expect(f.tx.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'INACTIVE', providerId: null }) as unknown,
      }),
    );
    f.tx.subscription.update.mockClear();
    f.tx.subscription.findUniqueOrThrow.mockResolvedValue({
      ...trial,
      providerId: 'replacement',
      syncStartedAt: now,
    });
    await f.repository.cancelled('old');
    expect(f.tx.subscription.update).not.toHaveBeenCalled();
  });
});
function activeResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      shop: { myshopifyDomain: shop },
      currentAppInstallation: {
        activeSubscriptions: [
          {
            id: 'gid://shopify/AppSubscription/1',
            name: 'GhostShopper Standard',
            status: 'ACTIVE',
            test: true,
            currentPeriodEnd: future.toISOString(),
            lineItems: [
              {
                plan: {
                  pricingDetails: {
                    __typename: 'AppRecurringPricing',
                    interval: 'EVERY_30_DAYS',
                    price: { amount: '19.0', currencyCode: 'USD' },
                  },
                },
              },
            ],
            ...overrides,
          },
        ],
      },
    },
  };
}
describe('Shopify billing adapter without live charges', () => {
  it('verifies tenant, exact plan, status, currency and test mode', async () => {
    const graphql = vi.fn<BillingGraphql>().mockResolvedValue(Response.json(activeResponse()));
    const provider = new ShopifyBillingProvider(shop, graphql, policy, 'https://app.example.com');
    expect(await provider.current()).toEqual({
      providerId: 'gid://shopify/AppSubscription/1',
      periodEnd: future,
    });
    for (const overrides of [
      { test: false },
      { status: 'FROZEN' },
      { name: 'Other' },
      { currentPeriodEnd: null },
      { lineItems: [] },
    ]) {
      graphql.mockResolvedValue(Response.json(activeResponse(overrides)));
      await expect(provider.current()).rejects.toThrow();
    }
    const forged = activeResponse();
    forged.data.shop.myshopifyDomain = 'other.myshopify.com';
    graphql.mockResolvedValue(Response.json(forged));
    await expect(provider.current()).rejects.toThrow('BILLING_INVALID_RESPONSE');
  });
  it('does not treat provider failure or malformed data as cancellation', async () => {
    const graphql = vi.fn<BillingGraphql>();
    const provider = new ShopifyBillingProvider(shop, graphql, policy, 'https://app.example.com');
    for (const response of [
      new Response('', { status: 503 }),
      Response.json({}),
      Response.json({ ...activeResponse(), errors: ['private'] }),
    ]) {
      graphql.mockResolvedValue(response);
      await expect(provider.current()).rejects.toThrow();
    }
    graphql.mockResolvedValue(
      Response.json({
        data: {
          shop: { myshopifyDomain: shop },
          currentAppInstallation: { activeSubscriptions: [] },
        },
      }),
    );
    expect(await provider.current()).toBeNull();
  });
  it('uses server-owned price and return URL, no mutation retries or second free trial', async () => {
    const graphql = vi.fn<BillingGraphql>().mockResolvedValue(
      Response.json({
        data: {
          appSubscriptionCreate: {
            userErrors: [],
            appSubscription: { id: 'gid://shopify/AppSubscription/1' },
            confirmationUrl: `https://${shop}/admin/charges/1`,
          },
        },
      }),
    );
    const provider = new ShopifyBillingProvider(shop, graphql, policy, 'https://app.example.com');
    expect(await provider.checkout()).toContain(shop);
    expect(graphql.mock.calls[0]?.[1]).toMatchObject({
      tries: 1,
      variables: {
        test: true,
        returnUrl: `https://app.example.com/app/billing?shop=${shop}`,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: { price: { amount: '19.00', currencyCode: 'USD' } },
            },
          },
        ],
      },
    });
    expect(JSON.stringify(graphql.mock.calls)).not.toContain('trialDays');
  });
  it.each([
    'https://evil.example/confirm',
    'http://admin.shopify.com/confirm',
    'https://admin.shopify.com.evil.example',
    'https://user:secret@admin.shopify.com/',
  ])('rejects unsafe confirmation URL %s', (url) => {
    expect(() => safeApprovalUrl(url, shop)).toThrow();
  });
  it('cancels only the server-owned subscription without prorated refunds', async () => {
    const graphql = vi.fn<BillingGraphql>().mockResolvedValue(
      Response.json({
        data: {
          appSubscriptionCancel: {
            userErrors: [],
            appSubscription: { id: 'gid://shopify/AppSubscription/1', status: 'CANCELLED' },
          },
        },
      }),
    );
    await new ShopifyBillingProvider(shop, graphql, policy, 'https://app.example.com').cancel(
      'gid://shopify/AppSubscription/1',
    );
    expect(graphql.mock.calls[0]?.[0]).toContain('prorate: false');
  });
});
describe('billing orchestration', () => {
  it('refreshes from provider before checkout and does not grant access on confirmation creation', async () => {
    const repository = {
      sync: vi.fn(),
      reserveCheckout: vi.fn().mockResolvedValue({ token: 'token', url: null }),
      saveCheckout: vi.fn(),
      subscriptionId: vi.fn(),
      cancelled: vi.fn(),
    };
    const provider = {
      current: vi.fn().mockResolvedValue(null),
      checkout: vi.fn().mockResolvedValue('https://admin.shopify.com/confirm'),
      cancel: vi.fn(),
    };
    const service = new BillingService(repository, provider);
    expect(await service.checkout()).toBe('https://admin.shopify.com/confirm');
    expect(repository.sync).toHaveBeenCalledWith(null, expect.any(Date));
    expect(repository.saveCheckout).toHaveBeenCalledWith(
      'token',
      'https://admin.shopify.com/confirm',
    );
    provider.current.mockRejectedValue(new Error('unavailable'));
    await expect(service.checkout()).rejects.toThrow();
    expect(provider.checkout).toHaveBeenCalledOnce();
  });
});
