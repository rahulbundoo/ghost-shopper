import type { BillingProvider } from '@ghostshopper/application';
import type { BillingPolicy } from '@ghostshopper/domain';
import {
  subscriptionResultSchema,
  checkoutResultSchema,
  cancelResultSchema,
  shopDomainSchema,
} from '@ghostshopper/contracts';
export const BILLING_PLAN_NAME = 'GhostShopper Standard';
export type BillingGraphql = (
  query: string,
  options: { variables?: Record<string, unknown>; signal: AbortSignal; tries: number },
) => Promise<Response>;
export const BILLING_QUERY = `#graphql
query GhostShopperBilling { shop { myshopifyDomain } currentAppInstallation { activeSubscriptions {
  id name status test currentPeriodEnd lineItems { plan { pricingDetails { __typename
    ... on AppRecurringPricing { interval price { amount currencyCode } }
  } } }
} } }`;
export function safeApprovalUrl(value: string, shop: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    (url.hostname !== shop && url.hostname !== 'admin.shopify.com')
  )
    throw new Error('BILLING_INVALID_RESPONSE');
  return url.href;
}
export class ShopifyBillingProvider implements BillingProvider {
  private readonly shop: string;
  constructor(
    shop: string,
    private readonly graphql: BillingGraphql,
    private readonly policy: BillingPolicy,
    private readonly appUrl: string,
  ) {
    this.shop = shopDomainSchema.parse(shop);
  }
  private async request(query: string, variables?: Record<string, unknown>): Promise<unknown> {
    const response = await this.graphql(query, {
      ...(variables ? { variables } : {}),
      signal: AbortSignal.timeout(10000),
      tries: 1,
    });
    if (!response.ok) throw new Error('BILLING_UNAVAILABLE');
    return response.json() as Promise<unknown>;
  }
  async current() {
    const result = subscriptionResultSchema.parse(await this.request(BILLING_QUERY));
    if (result.errors?.length || result.data.shop.myshopifyDomain !== this.shop)
      throw new Error('BILLING_INVALID_RESPONSE');
    const active = result.data.currentAppInstallation.activeSubscriptions;
    if (!active.length) return null;
    // A changed/unknown price or test mode must not silently grant paid entitlement.
    const plan = active.find(
      (item) =>
        item.status === 'ACTIVE' &&
        item.name === BILLING_PLAN_NAME &&
        item.test === this.policy.test &&
        item.lineItems.length === 1 &&
        item.lineItems[0]?.plan.pricingDetails.__typename === 'AppRecurringPricing' &&
        item.lineItems[0].plan.pricingDetails.interval === 'EVERY_30_DAYS' &&
        item.lineItems[0].plan.pricingDetails.price?.currencyCode === 'USD' &&
        Number(item.lineItems[0].plan.pricingDetails.price.amount) === Number(this.policy.priceUsd),
    );
    if (!plan?.currentPeriodEnd || active.length !== 1) throw new Error('BILLING_PLAN_MISMATCH');
    return { providerId: plan.id, periodEnd: new Date(plan.currentPeriodEnd) };
  }
  async checkout() {
    const result = checkoutResultSchema.parse(
      await this.request(
        `mutation GhostShopperSubscribe($name: String!, $returnUrl: URL!, $test: Boolean!, $lineItems: [AppSubscriptionLineItemInput!]!) {
      appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) { userErrors { field message } confirmationUrl appSubscription { id } }
    }`,
        {
          name: BILLING_PLAN_NAME,
          test: this.policy.test,
          returnUrl: `${this.appUrl}/app/billing?shop=${encodeURIComponent(this.shop)}`,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: { amount: this.policy.priceUsd, currencyCode: 'USD' },
                  interval: 'EVERY_30_DAYS',
                },
              },
            },
          ],
        },
      ),
    );
    const payload = result.data.appSubscriptionCreate;
    if (
      result.errors?.length ||
      payload.userErrors.length ||
      !payload.appSubscription ||
      !payload.confirmationUrl
    )
      throw new Error('BILLING_CHECKOUT_FAILED');
    return safeApprovalUrl(payload.confirmationUrl, this.shop);
  }
  async cancel(id: string) {
    const result = cancelResultSchema.parse(
      await this.request(
        `mutation GhostShopperCancel($id: ID!) {
      appSubscriptionCancel(id: $id, prorate: false) { userErrors { field message } appSubscription { id status } }
    }`,
        { id },
      ),
    );
    const payload = result.data.appSubscriptionCancel;
    if (
      result.errors?.length ||
      payload.userErrors.length ||
      payload.appSubscription?.id !== id ||
      payload.appSubscription.status !== 'CANCELLED'
    )
      throw new Error('BILLING_CANCEL_FAILED');
  }
}
