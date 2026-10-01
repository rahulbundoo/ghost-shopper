# Merchant UI

Phase 9 provides embedded Polaris pages at `/app`, `/app/monitors`, `/app/runs` and `/app/incidents`, with individual monitor, run and incident pages. All document/data loaders authenticate independently. Changes use the existing bearer-authenticated APIs through App Bridge's same-origin fetch support.

## Reading results

The overview summarizes the latest 25 requested runs, including the latest desktop/mobile observation within that sample, up to five recent open incidents and up to five severity-ranked detected findings from the latest run attempt. It does not claim aggregate store-wide coverage or a current health guarantee. No data, pending checks and runner errors are not passes. Times are UTC; Refresh results explicitly reloads data. There is no background polling.

Lists use 25-row pages plus one lookahead row; offsets are bounded. Run details separate attempts, technical scores/findings, AI interpretation, screenshots and diagnostic exports. A null technical score means unavailable, not zero. Missing AI analysis is not a GOOD result. AI findings render as plain text, never HTML. Incident details show recurrence counts, first/last observation and the recovery run when resolved. Monitor edits/disabling do not resolve incidents.

## Monitor configuration

Create/edit supports name, product GID, optional variant GID, desktop/mobile, frequency and enabled state. Product IDs can be copied from Shopify admin as explained in the form. The current app requests no product scope, so there is no permission-dependent catalog picker or catalog validation. Verify that the selected product/variant is published and belongs to the storefront. Adding catalog access requires a separately reviewed scope change.

Edits submit the loaded version and preserve entered values on conflict; reload before resubmission. Run now uses the saved monitor and the existing asynchronous dispatch API, never Playwright in web. It rejects a second active run for the same monitor. Mutations are not automatically retried. If a network response is lost, check saved records/run history before retrying: a request may already have succeeded. Frequency drives recurring checks when deployment scheduling is enabled. Settings provides deployment configuration indicators, email opt-in/recovery preference and the latest ten delivery records; it is not a live runner heartbeat. Billing is not implemented. See [automation activation](AUTOMATION.md).

## Evidence

Evidence URLs are fetched on explicit Open evidence, after tenant/expiry authorization on the server. URLs are not stored in browser storage and disappear at their short-lived expiry. Screenshots use no-referrer image requests; download links use noreferrer/noopener. Unavailable, failed or expired evidence is shown without claiming it exists. Image-load failure clears the link so it can be requested again. Console/network/metadata/trace exports are downloadable; raw logs are not needed to understand the result.

## Docker-free acceptance

`apps/web/ui-fixture` is a separate loopback-only Vite harness importing real UI components with synthetic records. It is not in production routes, does not bypass authentication and has no working backend. Start with:

```powershell
node apps/web/node_modules/vite/bin/vite.js --config apps/web/ui-fixture/vite.config.ts
```

Open `http://127.0.0.1:4179/app`. Polaris rendering uses Shopify's CDN. Automated browser tests stub API responses and block the CDN to keep interaction tests offline; Chrome DevTools separately checks real Polaris rendering. These are component/interaction checks, not embedded Shopify acceptance.

Before merchant rollout, use an authorized Shopify development store with migrated PostgreSQL, Redis, runner and private S3 storage. Verify App Bridge navigation/authenticated mutations inside admin; create/edit/disable; stale edits; queued-to-terminal runs; cross-tenant/missing IDs; pagination; incident recovery; and real signed screenshot loading/expiry. No Shopify, database or storage credentials are supplied by the fixture. Live embedded and real-storage acceptance remain required.
