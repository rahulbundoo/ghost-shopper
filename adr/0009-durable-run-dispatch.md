# 0009: Durable dispatch and fenced runner ownership

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md Phase 3

## Decision

Use BullMQ 6.3.10 with a stable run UUID job ID, bounded retention, three retry attempts and exponential backoff. PostgreSQL is authoritative: run creation atomically sets dispatch intent. Web attempts a short publish and returns 202 even when delivery remains pending. Runner reconciles pending work every five seconds, with a 60-second redispatch interval after successful publication.

Use serializable claims with tenant/installation/monitor checks, a unique lease token and a persisted three-attempt limit. All subsequent state writes require the current unexpired token. Terminal runs never re-execute. Reclaim expired attempts under a new token. Keep dispatch/ownership fields out of merchant responses. Existing Phase 2 runs are not automatically dispatched by migration.

## Consequences

No distributed transaction, extra service or new scheduler infrastructure is introduced. Pending intents survive Redis outages and process crashes. Delivery remains at least once; fencing makes database state idempotent, not arbitrary remote side effects exactly once. Each HTTP run-creation request still creates a new run. Timed-out execution is terminal and receives an abort signal; future executors must respect cancellation and cleanup.

The default production executor records JOURNEY_ENGINE_NOT_IMPLEMENTED until Phase 4. Test executors verify successful transitions without implying real storefront checks. The worker is still useful as the actual durable transport/lifecycle foundation.

Logs use a safe metadata allowlist; exception messages/credentials never enter queue failure messages. SIGTERM/SIGINT drain the worker within a bounded deadline. Redis must use persistence and noeviction. Local setup remains Node plus native/remote services, not Docker.

## Verification

Unit tests cover lifecycle/dispatch/processor behavior. Dedicated PostgreSQL tests verify claims and fencing; real Redis/PostgreSQL tests exercise delivery, duplicate suppression and retry. Service tests run in CI and require explicit test connection URLs locally.
