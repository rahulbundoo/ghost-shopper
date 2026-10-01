# Architecture

Phase 12 retains the two deployable applications. PostgreSQL coordinates shared request budgets and durable deletion leases; runner maintenance removes expired evidence and records dependency heartbeats. The web readiness endpoint is token-protected. Session encryption wraps the official adapter, and optional Sentry receives only fixed metadata. [ADR 0017](../adr/0017-production-hardening.md) documents deployment boundaries and operational acceptance.

## Accepted structure

A modular monolith plus an independent browser worker. Web owns Shopify integration, authenticated configuration and presentation. Runner owns asynchronous browser execution and processing. Packages are internal boundaries, not network services.

| Package       | Intended responsibility                                   |
| ------------- | --------------------------------------------------------- |
| domain        | Infrastructure-free business concepts and lifecycle rules |
| application   | Use cases and ports that depend on domain                 |
| contracts     | Validated process/API boundary contracts                  |
| database      | Prisma persistence and tenant-scoped repositories         |
| shopify       | Official Shopify authentication and GraphQL adapters      |
| browser       | Runner-only Playwright actions and evidence               |
| ai            | Provider adapters and versioned prompts                   |
| queue         | Redis/BullMQ producer and consumer adapters               |
| storage       | Private S3-compatible artifact adapters                   |
| notifications | Email adapters                                            |
| observability | Structured logs and telemetry                             |
| config        | Validated environment configuration                       |
| testkit       | Reusable test support                                     |

## Dependencies

Adapters depend inward on application/domain abstractions. Domain cannot depend on SDKs, frameworks, Node APIs or other packages. Web cannot import Playwright or the browser package. ESLint guards these static imports; tests exercise forbidden and allowed imports. Domain's emitted package is checked to have no runtime dependencies.

All packages are private ESM packages with strict TypeScript and explicit compiled exports. Internal dependencies use `workspace:*`; pnpm's recursive build follows declared dependency order. Do not bypass package exports with cross-package source paths. Web consumes config, database and Shopify adapters through package exports.

## Phase 1 boundary

Web uses the official Shopify React Router SDK for installation, authentication and the embedded App Bridge/Polaris shell. Authenticated GraphQL reads synchronize shop identity through tenant-scoped Prisma repositories. Session storage wraps Shopify's official Prisma adapter. Both the parent app route and its data loader authenticate independently.

Server-only workspace packages remain external to the Vite bundle so Node resolves Prisma's generated client correctly. Production packaging retains the workspace dependency graph. Local execution uses Node without Docker; PostgreSQL is needed for authenticated flows and the runner.

See [ADR 0001](../adr/0001-modular-monolith.md), [ADR 0002](../adr/0002-browser-worker-separation.md) and [ADR 0007](../adr/0007-shopify-shell.md).

## Phase 2 boundary

Web's resource routes authenticate each request independently and build MonitoringService with a tenant-bound repository set. Application owns use cases and persistence ports, contracts owns input validation, domain owns pure business types/rules, and database implements the ports using Prisma. ESLint prevents infrastructure imports into domain, application and contracts.

The Phase 2 API introduced record creation/retrieval with explicit bearer authentication, strict input fields, capped bodies/pagination and no-store responses. Phase 3 extends run creation with asynchronous dispatch. See [ADR 0008](../adr/0008-monitoring-persistence.md) and [the API contract](MONITORING_API.md).

## Phase 3 boundary

Web persists dispatch intent and attempts a bounded publish through the queue adapter. Runner owns reconciliation and BullMQ consumption, using application ports and database lease/claim operations. Domain owns transition rules. Observability serializes only allowlisted correlation metadata. No browser or AI code is loaded by web, and no third service is introduced.

Delivery is at least once; persisted run status and fenced ownership make terminal state handling idempotent. Queue retention cannot authorize rerunning a terminal run. See [ADR 0009](../adr/0009-durable-run-dispatch.md).

## Phase 4 boundary

Runner composes PlaywrightJourneyEngine with its execution port and a lease-bound step recorder. Browser owns isolated contexts, seven semantic actions, LocatorResolver, bounded public storefront reads and an in-process restricted egress proxy. Domain owns ActionResult/RunStep vocabulary; contracts validates step data; database persists tenant-scoped steps; web returns them with run details without importing Playwright. See [ADR 0010](../adr/0010-browser-journey-engine.md).

## Phase 5 boundary

Browser emits evidence bytes through a sink, without knowing S3 or Prisma. Runner composes that sink with application ArtifactRepository/ArtifactStorage ports, lease-fenced metadata persistence and the S3 adapter. Domain owns Artifact metadata and closed types; contracts validates reservations. Web authenticates tenant-bound artifact access before signing short-lived downloads. Bytes never enter PostgreSQL; storage keys never enter run-detail responses. No new service or AI integration is added. See [ADR 0011](../adr/0011-private-evidence-lifecycle.md).

## Phase 6 boundary

Domain owns deterministic finding/severity/scoring/identity rules without infrastructure imports. Runner derives bounded facts from diagnostic JSON before upload. Application defines AnalysisRepository; database validates input, reads authoritative persisted steps, hashes identities and saves summaries/findings atomically under the run lease. Web reads active-tenant analyses alongside run details, with no Playwright or AI import. No new service or runtime dependency is introduced. See [ADR 0012](../adr/0012-deterministic-technical-analysis.md).

## Phase 7 boundary

Domain owns incident vocabulary, recovery eligibility and stable ordering/configuration identity. PrismaRunStore atomically reconciles persisted analysis into incidents when completing a run, using a monitor row lock and the existing execution lease. Unique occurrence rows make counts idempotent. Application exposes tenant-bound incident reads; web independently authenticates list/detail routes. No service, dependency, AI call or notification subsystem is added. See [ADR 0013](../adr/0013-atomic-incident-lifecycle.md).

## Phase 8 boundary

Application defines AiProvider and AiAnalysisRepository ports; domain owns experience types and severity policy; contracts validates bounded structured inputs/results. The AI adapter owns the immutable prompt and single OpenAI HTTP integration. Runner collects a bounded subset of existing masked screenshots and invokes optional AI after technical completion. Database reserves one-shot requests and stores separate audit/results/cost metadata. Web reads AI results through tenant-bound repositories but does not load the provider. No service or external dependency is added. See [ADR 0014](../adr/0014-optional-ai-analysis.md).

## Phase 9 boundary

Merchant UI is confined to web: independently authenticated React Router loaders call MonitoringService and tenant-bound repositories; App Bridge fetch sends mutations to existing authenticated APIs. Private evidence is signed only on demand. Technical and AI views remain separate and attempt-scoped. Overview queries are bounded recent samples, not new aggregate health rules. A synthetic UI harness outside production routes supports Docker-free checks. No schema, service, dependency, Shopify scope or runner boundary changed. See [merchant UI](MERCHANT_UI.md).

## Phase 11 boundary

Phase 11 retains these boundaries. Domain owns allowance policy; application owns BillingProvider/BillingRepository ports and approval/reconciliation orchestration. Database serializes admission and writes usage with the queued run. The Shopify adapter performs billing GraphQL requests. Web exposes authenticated billing management; runner periodically verifies installed tenants through stored offline sessions. Browser execution does not know about prices or subscriptions. See [ADR 0016](../adr/0016-billing-admission.md).

## Phase 10 boundary

Domain owns cadence/significance policy and settings/history types. Application owns AutomationStore/EmailSender ports and bounded delivery orchestration. Database coordinates due monitors, durable dispatch intent and incident email intent using existing PostgreSQL transactions, then fences delivery leases and persists cooldowns. Notifications implements a fixed Resend HTTP adapter; only runner loads it. Web provides authenticated settings and history through MonitoringService. There is no new deployable service or third-party runtime dependency. See [ADR 0015](../adr/0015-durable-scheduling-alerts.md) and [automation operations](AUTOMATION.md).
