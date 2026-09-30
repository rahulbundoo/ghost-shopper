import { AppProvider } from '@shopify/shopify-app-react-router/react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Outlet,
  useLoaderData,
  useRouteError,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from 'react-router';
import { getRuntime, withShopifyBoundary } from '../shopify.server';

export async function loader({ request }: LoaderFunctionArgs) {
  return withShopifyBoundary(async () => {
    const { shopify, config } = getRuntime();
    await shopify.authenticate.admin(request);
    return { apiKey: config.apiKey };
  });
}
export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
