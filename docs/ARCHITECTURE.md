# Architecture

## Shape

GhostShopper is a modular monolith with one independent browser worker.

```text
Shopify merchant
      |
   apps/web
      |
PostgreSQL + BullMQ
      |
  apps/runner
   /   |    \
browser AI  storage/notifications
```

There are two deployable applications:

- `apps/web` — Shopify auth, tenant context, merchant UI/API, monitor configuration and billing.
- `apps/runner` — durable job consumption, browser execution, analysis, scheduling and notification orchestration.

Workspace packages are architecture boundaries, not services.

## Package responsibilities

| Package | Responsibility |
| --- | --- |
| `domain` | infrastructure-free business concepts and policy |
| `application` | use cases and ports |
| `contracts` | strict API/process/provider schemas |
| `database` | Prisma persistence, tenant scoping, locks/leases |
| `shopify` | official Shopify adapters |
| `browser` | Playwright, network safety, evidence, safe semantic execution |
| `ai` | provider adapters and versioned prompts |
| `queue` | BullMQ/Redis adapters |
| `storage` | private S3-compatible artifact storage |
| `notifications` | email provider adapters |
| `observability` | structured logs/telemetry |
| `config` | validated environment configuration |
| `testkit` | shared test support |

Dependencies point inward: adapters may depend on application/domain abstractions; domain never depends on infrastructure.

## Current deterministic execution

```text
merchant monitor
-> persisted TestRun
-> durable queue dispatch
-> runner claims lease
-> PlaywrightJourneyEngine
-> seven deterministic actions
-> evidence/diagnostics
-> deterministic analysis
-> incident reconciliation
-> optional AI experience analysis
-> notification
```

The web app never imports or runs Playwright.

AI currently analyzes bounded post-run evidence only. It does not control browser actions.

## Planned autonomous execution

Phase 13 adds a second browser orchestration path:

```text
agentic mission
-> sanitized BrowserObservation
-> ShopperAgent decision
-> contracts validation
-> deterministic ActionPolicy
-> semantic browser executor
-> persisted audited step
-> repeat within budgets
```

The autonomous loop composes existing adapters but does not replace `PlaywrightJourneyEngine`.

The model-facing decision contains semantic intent only. Browser implementation details stay inside `packages/browser`.

See ADR 0018.

## Trust boundaries

### Browser

The browser process is untrusted execution against an untrusted public storefront.

Network destination, writes, navigation, checkout behavior, evidence, and time are constrained by code.

### AI

AI output is untrusted external input.

It must pass strict schema validation and deterministic policy before any effect.

### Shopify/web

Tenant identity comes from verified Shopify authentication, never request-owned shop IDs.

### Persistence/queue

Jobs are at-least-once. Database leases/fencing make terminal state transitions idempotent and prevent stale owners from writing.

## Architectural invariants

- no browser execution in web;
- no SDK/framework imports in domain;
- no direct AI-to-Playwright tool channel;
- no payment submission;
- tenant-scoped merchant data;
- private evidence access;
- safe fixed error/log fields at trust boundaries;
- no implicit startup migrations;
- material trust/architecture changes require an ADR.

## Documentation

Read only the area relevant to the task. `docs/README.md` is the router.

Historical ADRs explain decisions; they are not required startup context. Current autonomous work is decomposed in `tasks/PHASE_13_AUTONOMOUS_SHOPPER.md`.
