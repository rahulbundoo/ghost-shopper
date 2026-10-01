import { AppProvider } from '@shopify/shopify-app-react-router/react';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Outlet,
  useLoaderData,
  useRouteError,
  useNavigation,
  NavLink,
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
  const navigation = useNavigation();
  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Overview</s-link>
        <s-link href="/app/monitors">Monitors</s-link>
        <s-link href="/app/runs">Runs</s-link>
        <s-link href="/app/incidents">Incidents</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/billing">Billing</s-link>
      </s-app-nav>
      <div className="gs-app">
        <nav className="gs-nav" aria-label="GhostShopper">
          <strong>GhostShopper</strong>
          <NavLink to="/app" end>
            Overview
          </NavLink>
          <NavLink to="/app/monitors">Monitors</NavLink>
          <NavLink to="/app/runs">Runs</NavLink>
          <NavLink to="/app/incidents">Incidents</NavLink>
          <NavLink to="/app/settings">Settings</NavLink>
          <NavLink to="/app/billing">Billing</NavLink>
        </nav>
        <div className="gs-loading" role="status">
          {navigation.state !== 'idle' ? 'Loading page…' : ''}
        </div>
        <div id="merchant-content">
          <Outlet />
        </div>
      </div>
    </AppProvider>
  );
}
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
