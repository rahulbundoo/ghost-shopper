# Scheduling and email alerts

Phase 10 runs scheduled checks and sends significant incident and recovery emails through the existing runner. Both deployment features default to off. Merchant email consent is separate from deployment configuration. This document explains activation, delivery guarantees and the live checks still required.

## Enable in a development deployment

1. Apply migration `202609300009_scheduling_alerts` to PostgreSQL using the existing migration command. Startup never migrates automatically.
2. Set `SCHEDULER_ENABLED=true` in the runner environment. Use the same value in web so Settings accurately describes deployment configuration. Enabled monitors become eligible on the next scan; review existing monitors before activating.
3. To send emails, configure `EMAIL_ENABLED=true`, `RESEND_API_KEY`, a bare `EMAIL_FROM` address on a verified Resend domain, and the HTTPS `SHOPIFY_APP_URL`. Use the same configuration in web and runner. Missing or invalid optional email configuration disables delivery without disabling technical monitoring.
4. In GhostShopper Settings, enter an address you control, opt in, and choose whether to receive recovery messages. Saving does not send a test email. Keep the runner, PostgreSQL and Redis available.

No new local service or Docker container is required. No account, sending domain or provider key is provisioned automatically. Production domain verification and delivery costs are the operator's responsibility. See the [Resend send API](https://resend.com/docs/api-reference/emails/send-email).

## Scheduling behavior

The runner scans up to 50 due monitors per maintenance tick. PostgreSQL locks due monitor rows with `FOR UPDATE SKIP LOCKED`; creating a snapshot run with durable dispatch intent and advancing `nextRunAt` happen in one transaction. Existing BullMQ publication, retries and fenced run ownership remain unchanged.

New monitors are immediately eligible. Hourly, six-hourly and daily intervals are measured from the scan time in UTC, not wall-clock cron times. Downtime produces one new check, not a replay of every missed interval. An active run delays scheduling for that monitor by one minute. Manual Run now uses the same monitor lock and rejects an existing active run with 409; it does not change the next scheduled time. There is no catch-up burst and no guarantee of exact-time execution.

Frequency changes or an explicit `enabled: true` update reset the next due time by one full interval. The current editor submits all fields, so saving an enabled monitor also resets its interval. Scheduling does not change the monitor version. Disabling blocks future claims. Uninstall cancels nonterminal runs, disables monitors and notification settings, and cancels pending email; reinstall requires deliberate re-enablement.

## Alert policy

New or reopened HIGH/CRITICAL **detected** incidents create failure email intent atomically with run completion and incident updates. Multiple significant findings from one run are grouped into one failure message. Repeated occurrences, LOW/MEDIUM/INFO findings, AI suggestions and runner infrastructure errors do not produce failure emails. A later complete clean check creates recovery intent only when significant incidents actually resolve.

Delivery rechecks installation, monitor configuration, recipient version and opt-in. Recovery requires an accepted failure notification for the same configuration and channel version. Unsent obsolete failures/recoveries are cancelled. An already submitted request cannot be recalled; a race with uninstall, settings changes or recovery can still allow that in-flight message to arrive.

Each shop has a persisted 15-minute interval between send attempts, including retries. A delivery is attempted at most six times. Pending events or retries older than 23 hours (measured from creation until first attempt, then from first attempt) fail closed. These bounds prevent old backlogs and retries from exceeding the provider's 24-hour idempotency window. The stable delivery ID is the idempotency key. No exactly-once inbox guarantee is claimed; Resend acceptance is not proof of delivery. See [provider idempotency semantics](https://resend.com/docs/dashboard/emails/idempotency-keys).

Requests use a fixed HTTPS endpoint, a 10-second timeout and no redirects. HTTP 429/409/5xx and network ambiguity are retryable; other non-success statuses fail. The message template contains only a fixed summary, shop domain and authenticated run link, not screenshots, logs or AI text. Recipient and event data are snapshotted. Keep the sender, app origin and message template stable while pending retries exist: changing the payload under the same idempotency key is rejected by the provider rather than silently duplicating email.

## Operations and limits

Settings displays the latest ten delivery records. PENDING waits for processing/cooldown; SENDING owns a 60-second lease; SENT means provider acceptance; FAILED exhausts policy or rejects delivery; CANCELLED means no longer eligible. Expired leases can be reclaimed. Writes require the current lease token. There is no automatic re-send of terminal deliveries.

Observe `scheduler.scan.failed`, `email.disabled`, `email.scan.failed` and `email.delivery` events. They omit recipients, keys and provider bodies. Settings reports web configuration, not a live runner heartbeat. Investigate missing checks using runner/service health and due monitor records. Email history stores recipient addresses internally; restrict/encrypt database access and define deployment retention. Shop redaction cascades settings and history, but cannot erase provider-side or delivered email. Bounce handling, recipient verification, delivery webhooks, unsubscribe tokens and retention automation remain production-hardening work; authenticated settings can disable alerts now.

## Verification

Unit tests cover cadence, opt-in validation, query locks, no-overlap, event grouping, cooldown, stale claims, stale recipient settings, expiry and adapter status handling. HTTP tests protect the settings routes. The synthetic browser harness tests the notification form without sending messages.

`pnpm test:database` requires a dedicated PostgreSQL database with all nine migrations. Its automation suite checks concurrent scans/manual requests, downtime, disabled/uninstalled shops, optimistic settings, tenant foreign keys, delivery claims, cancellation and redaction. Database test files run sequentially because the scheduler intentionally scans all eligible shops in that dedicated database. Without TEST_DATABASE_URL, these real SQL/concurrency checks are unverified locally.

Before rollout, use an authorized development storefront and recipient mailbox: trigger a scheduled failure, verify one grouped email, repeat the failure without another alert, recover and verify recovery mail, exercise provider failures and runner restarts, change/disable settings and uninstall. Do not shorten production cooldowns or send live mail as an implicit test. This implementation does not imply production readiness or live provider acceptance.
