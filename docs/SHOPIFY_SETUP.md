# Shopify development setup

## Requirements

Node 22.15+ (major 22), pnpm 10.34.6, a Shopify development app/store you control, and a dedicated native or remote PostgreSQL database. No Docker, Redis or object storage is needed.

## Configure persistence

Copy the root `.env.example` to `.env`. Set DATABASE_URL to the database you intend to use, for example `postgresql://USER:PASSWORD@127.0.0.1:5432/ghostshopper`. Use your database provider's required TLS parameters for a remote connection. Create the empty database with your PostgreSQL administrator tools first; this application does not create server users or databases.

Run `pnpm install --frozen-lockfile`, then `pnpm db:migrate`. The migrations create Shop/Session and Phase 2 Monitor/TestRun tables. They use PostgreSQL, never SQLite. Do not point development or tests at a production database.

## Link the development app

Run `pnpm shopify app config link` from the repository root and select your development app. The command needs an interactive Shopify sign-in. Keep the GhostShopper configuration in `shopify.app.toml`: embedded mode, managed installation, empty scopes, the auth callback and all webhook subscriptions. If the CLI creates a named configuration, copy those settings into it and select it with `pnpm shopify app config use`.

Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET in the root .env from the development app settings. These are the app client ID and secret, not a storefront token. The CLI supplies the HTTPS SHOPIFY_APP_URL during development. With a separately managed tunnel, set that origin explicitly and ensure application_url and redirect_urls match it. The placeholder example.invalid is deliberately rejected.

Run `pnpm dev:shopify` and select the development store. The CLI starts the web process defined in `apps/web/shopify.web.toml`, provides the tunnel and opens an installation preview. Use the preview/install link and approve installation in your own development store. Reopen GhostShopper inside Shopify Admin.

For the public shell alone, `pnpm dev` starts http://127.0.0.1:3000 without making Shopify requests. Stop one dev process before starting the other.

## Acceptance checklist

- Install the app from the CLI preview and open it within Shopify Admin.
- The embedded Polaris screen shows your store name/domain and verified connection.
- Refresh and restart the Node server; authentication survives via PostgreSQL sessions.
- Check that only the authenticated shop is returned, regardless of arbitrary query parameters.
- Confirm no product/customer/order permissions are requested.
- Uninstall: the signed webhook deletes that shop's sessions and records uninstall time.
- Reinstall: shop registration becomes active again.
- Exercise scope and privacy webhooks with the Shopify CLI/dev dashboard.
- Verify invalid signatures are rejected and one shop's lifecycle never modifies another.

The code is covered by local unit/HTTP tests and a separate PostgreSQL suite. This checklist cannot be claimed complete without a real development store and configured database.

## Troubleshooting

A 503 setup message means required server settings are missing/invalid. A temporary connection failure after installation can indicate unavailable PostgreSQL, unapplied migrations, expired credentials or Shopify API failure; logs include an opaque request ID without token values. API version is pinned to 2026-07 in both the adapter and TOML.

After changing a shared package, restart `pnpm dev` to rebuild its emitted JavaScript. Route/UI changes use Vite hot reload.
