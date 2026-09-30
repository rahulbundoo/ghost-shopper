import { fetchShopProfile, SHOPIFY_API_VERSION } from '@ghostshopper/shopify';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { getRuntime, withShopifyBoundary } from '../shopify.server';

export async function loader({ request }: LoaderFunctionArgs) {
  return withShopifyBoundary(async () => {
    const { shopify, shops } = getRuntime();
    // Nested loaders execute independently; authenticate this data boundary itself.
    const { admin, session } = await shopify.authenticate.admin(request);
    const profile = await fetchShopProfile(session.shop, admin.graphql);
    await shops.markInstalled(session.shop, session.scope ?? '');
    const shop = await shops.saveProfile(session.shop, profile);
    return {
      name: shop.name,
      domain: shop.id,
      storefrontUrl: shop.storefrontUrl,
      currencyCode: shop.currencyCode,
      syncedAt: shop.syncedAt?.toISOString(),
      apiVersion: SHOPIFY_API_VERSION,
    };
  });
}
export default function StoreConnection() {
  const shop = useLoaderData<typeof loader>();
  return (
    <s-page heading="Store connection">
      <s-banner tone="success" heading="Your store is connected">
        GhostShopper has verified your Shopify connection and saved your store.
      </s-banner>
      <s-section heading={shop.name ?? 'Your store'}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text type="strong">Shopify domain:</s-text> {shop.domain}
          </s-paragraph>
          <s-paragraph>
            <s-text type="strong">Currency:</s-text> {shop.currencyCode}
          </s-paragraph>
          {shop.storefrontUrl ? (
            <s-link href={shop.storefrontUrl} target="_blank">
              Visit storefront
            </s-link>
          ) : null}
          <s-paragraph>
            <s-text color="subdued">Connection verified with Shopify.</s-text>
          </s-paragraph>
        </s-stack>
      </s-section>
      <s-section heading="What happens next">
        <s-paragraph>
          Your store is ready for the next step. Monitoring is not active yet.
        </s-paragraph>
        <s-paragraph>
          GhostShopper’s shopping checks will stop at checkout initiation. They will never submit a
          payment.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
