# 0017 Production safeguards and operational acceptance

- Status: Accepted
- Date: 2026-10-01

## Context

Controlled external merchant testing needs shared abuse limits, encrypted credentials, durable evidence deletion and operational recovery. Browser safety and tenant isolation already exist, but code alone cannot establish deployed network isolation or restore readiness.

## Decision

Keep the modular monolith and independent runner. Add PostgreSQL rate buckets, deletion intents and heartbeats rather than another service. Encrypt Shopify access/refresh tokens around the official adapter using AES-256-GCM and session-bound authenticated data. Use bounded, lease-fenced runner maintenance for object deletion; keep bucket lifecycle as the independent fallback. Disable native traces by default.

Validate explicit deployment configuration and require operator attestations for infrastructure protections. Expose token-protected, dependency-aware readiness separately from liveness. Send only fixed metadata to optional Sentry. Provide native backup/isolated-restore and resumable session-key migration commands; do not provision infrastructure or execute production operations automatically.

## Consequences

Migration eleven backfills deletion intents for existing artifacts. Existing plaintext sessions need a stopped-writer migration or reauthorization before enabling encryption. Shared limits add a PostgreSQL write to authenticated operations. Deletion intents deliberately outlive tenant cascades; versioned storage still requires noncurrent-version lifecycle rules. A recent heartbeat is a coarse dependency signal, not full readiness of every external provider. Active tenant history and operator backups need an explicit privacy policy.

## Alternatives

In-memory limits would not coordinate replicas. Redis-only deletion state could disappear independently of authoritative database metadata. A full telemetry SDK would increase default data collection; the minimal envelope transport trades diagnostics for an explicit privacy boundary. None of these choices replaces deployed isolation, secret storage or restore drills.

## Verification

Unit/HTTP/SDK tests cover secret validation, token tampering, fixed limits, deletion fencing, telemetry minimization and startup failures. Dedicated PostgreSQL tests cover concurrent admission, encrypted adapter round trips and deletion after redaction. Real storage version deletion, restore recovery and deployment egress remain mandatory acceptance in [the runbook](../docs/HARDENING.md).
