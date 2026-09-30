import type { ActionFunctionArgs } from 'react-router';
import { parseScopeUpdate } from '@ghostshopper/shopify';
import { getRuntime, withShopifyBoundary } from '../shopify.server';
export async function action({ request }: ActionFunctionArgs) {
  return withShopifyBoundary(async () => {
    const { shopify, shops } = getRuntime();
    const { topic, shop, payload } = await shopify.authenticate.webhook(request);
    if (topic !== 'APP_SCOPES_UPDATE') return new Response(null, { status: 400 });
    const scopes = parseScopeUpdate(payload);
    if (!scopes) return new Response(null, { status: 400 });
    await shops.updateScopes(shop, scopes);
    return new Response(null, { status: 200 });
  });
}
