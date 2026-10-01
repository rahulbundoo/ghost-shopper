import { fetchShopProfile, SHOPIFY_API_VERSION } from '@ghostshopper/shopify';
import { data, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { getRuntime, withShopifyBoundary } from '../shopify.server';
import { merchantRead } from '../merchant.server';
import { Overview } from '../components/overview';

export async function loader({ request }: LoaderFunctionArgs) {
  return withShopifyBoundary(async () => {
    const { shopify, shops } = getRuntime();
    // Nested loaders execute independently; authenticate this data boundary itself.
    const { admin, session } = await shopify.authenticate.admin(request);
    const profile = await fetchShopProfile(session.shop, admin.graphql);
    await shops.markInstalled(session.shop, session.scope ?? '');
    const shop = await shops.saveProfile(session.shop, profile);
    const activity = await merchantRead(request, async (service) => {
      const [runs, incidents, monitors] = await Promise.all([
        service.listTestRuns({ limit: 25 }),
        service.listIncidents({ status: 'OPEN', limit: 6 }),
        service.listMonitors({ limit: 1 }),
      ]);
      const latest = runs[0];
      const analyses = latest ? await service.listRunAnalyses(latest.id) : [];
      return {
        runs,
        incidents,
        hasMonitors: monitors.length > 0,
        analysis: analyses.find((item) => item.attempt === latest?.attemptCount) ?? null,
      };
    });
    return data(
      {
        ...activity.data,
        name: shop.name,
        domain: shop.id,
        storefrontUrl: shop.storefrontUrl,
        currencyCode: shop.currencyCode,
        syncedAt: shop.syncedAt?.toISOString(),
        apiVersion: SHOPIFY_API_VERSION,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
export default function StoreConnection() {
  return <Overview data={useLoaderData<typeof loader>()} />;
}
export { PageError as ErrorBoundary } from '../components/merchant';
