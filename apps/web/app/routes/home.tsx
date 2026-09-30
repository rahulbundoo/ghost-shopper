import { isShopifyConfigured } from '@ghostshopper/config';
import { redirect, useLoaderData, type LoaderFunctionArgs } from 'react-router';

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.has('shop')) return redirect('/app' + url.search);
  return { configured: isShopifyConfigured(process.env) };
}
export default function Home() {
  const { configured } = useLoaderData<typeof loader>();
  return (
    <main className="landing">
      <p className="eyebrow">GHOSTSHOPPER / SHOPIFY</p>
      <div className="ghost" aria-hidden="true">
        G
      </div>
      <h1>
        A little peace of mind
        <br />
        for every shopping journey.
      </h1>
      <p className="intro">
        GhostShopper is taking shape. Connect your Shopify store to get started.
      </p>
      <section className="connection-card" aria-labelledby="connection-heading">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <h2 id="connection-heading">
            {configured ? 'Open your store connection' : 'Store connection awaiting setup'}
          </h2>
          <p>
            {configured
              ? 'Sign in with your store, or open GhostShopper from Shopify Admin.'
              : 'Your local app is running. Shopify installation becomes available once app setup is complete.'}
          </p>
        </div>
        {configured ? (
          <a className="button" href="/auth/login">
            Connect Shopify store
          </a>
        ) : null}
      </section>
      <p className="footnote">
        Shopping checks are not active yet. GhostShopper will stop at checkout and never submit a
        payment.
      </p>
    </main>
  );
}
