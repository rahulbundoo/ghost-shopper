# 0008: Tenant-scoped monitoring persistence

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md Phase 2

## Decision

Implement the phase's concrete success condition with Shop, Monitor and TestRun models, application ports/use cases, validated contracts, Prisma repositories and authenticated JSON resource routes. Keep Scenario a closed PURCHASE_JOURNEY vocabulary. Defer evidence/incidents/billing and their tables to the phases that implement their behavior.

Bind repositories to a server-authenticated shop once; operations never accept a tenant ID. Require active installation, explicit tenant predicates and composite tenant/monitor foreign keys. Use serializable transactions with at most three attempts for Prisma P2034 conflicts. Monitor edits use an atomic version predicate and increment. TestRun captures immutable monitor inputs/version and is initially QUEUED with no outcome.

## Consequences

The domain remains infrastructure-free; database implements application ports. No new external dependency, network service, Shopify permission, queue execution or UI screen is introduced. Node/native-or-remote-PostgreSQL workflows remain Docker-free locally.

Monitor/run history cascades only with the existing verified shop-redaction lifecycle; monitor deletion is not exposed. SQL CHECK constraints are maintained in migration SQL, not Prisma schema. No row-level-security policy is claimed: repositories provide row authorization and database constraints provide referential isolation.

Run creation is persistence only, not a Run now feature. Worker state transitions, dispatch idempotency and scheduling are Phase 3/later work. Product references are syntax-validated only until catalog selection is implemented. Database integration tests require a dedicated PostgreSQL database; mocks and compilation cannot substitute for them.
