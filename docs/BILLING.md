# Billing foundation

Phase 11 adds a time-limited trial, one fixed-price Shopify subscription, a per-period run allowance and a Billing screen. Billing is disabled by default. Prices are deployment configuration, not an approved commercial offer. No live subscription is created by setup, installation, a page load or automated tests.

## Activation

1. Apply all ten migrations, including `202609300010_billing_foundation`, to PostgreSQL using `pnpm db:migrate`. Do not point test commands at production.
2. Set identical billing configuration in web and runner: `BILLING_ENABLED=true`, `BILLING_PRICE_USD` as a positive two-decimal USD amount, and `BILLING_PAID_RUN_LIMIT` as the number of runs per 30-day period. There is no default paid price or allowance. Keep `BILLING_TEST=true` for development. The default trial is 14 days and 100 runs; both are configurable before rollout.
3. Configure the runner with the same Shopify app credentials, HTTPS origin, database and offline session storage as web. It now reconciles subscriptions using the official SDK's offline Admin API context. No new service, scope, SDK or Docker container is required.
4. Open Billing in an authorized development installation. Request the paid plan, follow the explicit Shopify approval link, and approve a **test** subscription. Returning to the app triggers server-side verification. A query parameter such as `charge_id` never grants access.
5. After live acceptance and commercial review, an operator may explicitly set `BILLING_TEST=false` for real charges. Do not mix test and live policy or change price/allowances while active subscriptions exist without a migration plan. Paid entitlement is tied to the verified test mode, price and allowance policy.

Disabling the deployment billing flag disables admission limits and billing operations; it does **not** cancel charges already held by Shopify. Cancel subscriptions before taking billing offline. Never use the flag as a cancellation mechanism.

## Trial and paid access

The trial starts on the first committed billing initialization: a Billing read or admitted/scheduler-checked run after enabling billing. It is not backdated to installation. Its persisted end date survives normal uninstall/reinstall. There is no automatic upgrade or credit-card collection by GhostShopper. Upgrade requires merchant approval and starts the paid allowance immediately; unused trial allowance does not carry over. A merchant who has had an active subscription never falls back to another trial.

The single plan is GhostShopper Standard, billed in USD every 30 days. There are no usage charges, automatic overages, annual plans, coupons or prorated refunds. The adapter validates Shopify's active subscription name, price, currency, interval, test flag and tenant identity. An unknown plan fails verification instead of being replaced or treated as free access. Creation returns Shopify's confirmation URL as described by the [subscription creation API](https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/appSubscriptionCreate).

Local subscription state is TRIAL, ACTIVE or INACTIVE. Eligibility is computed separately: expired trial, exhausted allowance, expired paid period, mismatched policy or stale paid verification blocks new runs. Paid usage is keyed by Shopify's verified period end, not the calendar month. Refreshing the same period does not reset usage; a verified renewal supplies the next allowance. Reports and configuration remain readable when admission is blocked.

## Usage accounting

Both Run now and the scheduler lock the shop's subscription before checking usage. Run creation, dispatch intent and one UsageRecord commit together. A compound tenant foreign key and unique shop/run key prevent cross-tenant or duplicate records. Worker retries, redelivery and repeated completion do not consume new units.

One admitted run costs one unit, even when it later fails, errors or is cancelled. There is no refund or overage path. Rejected manual requests return HTTP 402 with `BILLING_REQUIRED` or `RUN_LIMIT_REACHED`; scheduled monitors defer five minutes without creating runs. Existing queued/running work may finish after cancellation or expiry because its allowance was already reserved. With billing disabled, new usage is not metered and older runs are not backfilled.

Do not delete active-period run/usage records as a retention operation: cascading deletion would reduce counted usage. Retention automation and a separate long-term accounting policy belong to production hardening. Shop redaction deletes billing and usage state; no hidden trial-abuse record is retained after erasure.

## Reconciliation and cancellation

Billing page reads and explicit Refresh actions verify against Shopify. The runner scans up to five due installed shops per tick, with a five-minute retry interval and per-shop atomic claim. This uses stored tenant IDs and [offline Admin API access](https://shopify.dev/docs/api/shopify-app-react-router/latest/unauthenticated/unauthenticated-admin), never an untrusted job-supplied shop. Older reconciliation responses cannot overwrite newer observations. HTTP failures do not silently cancel a subscription or refresh its verification time.

Paid access expires after one hour without successful verification, or at the period end, whichever is earlier. A provider outage can therefore pause paid monitoring; local trials continue within their existing limits. Cancellation outside GhostShopper may take a polling interval to appear, bounded by that freshness window if polling fails. There is no billing webhook in this foundation. Monitor `billing.sync.failed` and `billing.scan.failed`; logs omit tokens, approval URLs and provider bodies.

Checkout creation has a ten-minute tenant reservation. Concurrent requests cannot create charges simultaneously; successful pending links are reused within the reservation. Ambiguous failures are not automatically retried. After the reservation expires, refresh Shopify state before requesting a new link. This is not a claim of exactly-once remote charge creation.

Cancellation requires an explicit acknowledgement in the UI. The server derives the subscription ID from verified tenant state and requests `prorate: false`; new paid runs stop on confirmed cancellation. Shopify manages the actual charge, and [its cancellation API](https://shopify.dev/docs/api/admin-graphql/2026-01/payloads/AppSubscriptionCancelPayload) remains authoritative. If confirmation fails, refresh rather than assuming success. Uninstall clears local entitlement and pending checkout links, preserves trial history, and relies on Shopify's app lifecycle for provider-side billing cancellation.

## Acceptance still required

Local suites stub the billing provider; no money moves. The dedicated PostgreSQL suite exercises concurrent last-unit admission, scheduler limits, rollback, compound tenant constraints, renewal, checkout reservations and uninstall/redaction. It requires TEST_DATABASE_URL and all migrations; mock tests do not establish database concurrency correctness.

Before rollout, verify test-charge approval and decline, return navigation inside Shopify Admin, renewal dates, frozen/cancelled subscriptions, uninstall/reinstall, provider outage recovery and simultaneous manual/scheduled requests on an authorized development store. Confirm that this app's distribution and pricing configuration support the Billing API; do not combine this flow with Shopify-managed pricing without a separate integration review. Production readiness, financial reconciliation, retention, webhook-driven updates and multi-plan migration remain outside this foundation.
