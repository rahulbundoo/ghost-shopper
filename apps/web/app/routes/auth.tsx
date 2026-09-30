import type { LoaderFunctionArgs } from 'react-router';
import { getRuntime, withShopifyBoundary } from '../shopify.server';
export async function loader({ request }: LoaderFunctionArgs) {
  return withShopifyBoundary(async () => {
    await getRuntime().shopify.authenticate.admin(request);
    return null;
  });
}
