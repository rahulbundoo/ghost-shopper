import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from 'react-router';
import './styles.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>GhostShopper</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const message =
    status === 404
      ? 'This page could not be found.'
      : status === 503
        ? 'GhostShopper is not ready to connect. Complete app setup or try again shortly.'
        : 'We could not open GhostShopper. Please reopen the app from Shopify Admin.';
  return (
    <main className="landing">
      <p className="eyebrow">GHOSTSHOPPER</p>
      <h1>{status === 404 ? 'Page not found' : 'Unable to connect'}</h1>
      <p>{message}</p>
      <a className="button" href="/">
        Return home
      </a>
    </main>
  );
}
