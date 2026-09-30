import type { ActionFunctionArgs } from 'react-router';
import { getRuntime, withShopifyBoundary } from '../shopify.server';
export async function action({ request }: ActionFunctionArgs) {
  return withShopifyBoundary(async () => {
    const { shopify, shops } = getRuntime();
    const { topic, shop } = await shopify.authenticate.webhook(request);
    if (topic === 'SHOP_REDACT') await shops.redactUninstalledShop(shop);
    else if (topic !== 'CUSTOMERS_DATA_REQUEST' && topic !== 'CUSTOMERS_REDACT') {
      return new Response(null, { status: 400 });
    }
    // Phase 1 stores offline app sessions only, and never reads customer data.
    return new Response(null, { status: 200 });
  });
}
