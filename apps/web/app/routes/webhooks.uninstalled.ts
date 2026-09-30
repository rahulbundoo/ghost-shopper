import type { ActionFunctionArgs } from 'react-router';
import { getRuntime, withShopifyBoundary } from '../shopify.server';
export async function action({ request }: ActionFunctionArgs) {
  return withShopifyBoundary(async () => {
    const { shopify, shops } = getRuntime();
    const { topic, shop } = await shopify.authenticate.webhook(request);
    if (topic !== 'APP_UNINSTALLED') return new Response(null, { status: 400 });
    await shops.uninstall(shop);
    return new Response(null, { status: 200 });
  });
}
