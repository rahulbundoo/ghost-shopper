# Durable scheduling and incident emails

Status: Accepted for Phase 10 implementation.

## Context

Recurring monitors must survive runner restarts without duplicating work. Significant incident transitions must produce emails without sending one message for every failed run. PostgreSQL already owns monitor configuration and incident transactions; BullMQ already carries run IDs to the independent browser runner.

## Decision

Store monitor due times in PostgreSQL and scan locked due rows in the existing runner. Use `FOR UPDATE SKIP LOCKED`, create run dispatch intent and advance cadence atomically, skip missed intervals, and exclude active monitor runs. Manual requests share the monitor lock. Do not introduce cron infrastructure or a second scheduler service.

Write grouped email intent in the existing incident-completion transaction. A bounded runner delivery loop claims persisted leases, rechecks tenant/consent/configuration, and calls the EmailSender port outside database transactions. The initial adapter uses the fixed Resend HTTPS API with native fetch, a stable idempotency key and bounded retries inside the provider's retention window. Technical results never depend on provider availability. No new third-party runtime package or Shopify scope is required.

## Consequences

Both features require explicit deployment opt-in; email also requires merchant opt-in and provider setup. Multiple runners coordinate through database locks, persisted cooldowns and leases. PostgreSQL polling adds bounded traffic and scheduling precision depends on runner availability. Provider acceptance cannot establish inbox delivery, and in-flight messages cannot be recalled. No exactly-once remote side effect is promised. Real PostgreSQL, Shopify and email-provider acceptance are still required; see [operating policy](../docs/AUTOMATION.md).
