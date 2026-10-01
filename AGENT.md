# GhostShopper AI engineering contract

This is the primary repository instruction file for AI coding agents.

## Mission

GhostShopper is evolving from a deterministic Shopify synthetic monitor into a hybrid product:

1. Deterministic monitors verify known purchase paths reliably.
2. Autonomous mystery shoppers explore authorized public storefronts like bounded human shoppers to discover unknown friction.

The deterministic system is production foundation, not legacy code to replace.

Current implementation status and planned evolution live in `docs/PRODUCT.md` and `docs/EVOLUTION.md`.

## Read protocol

Do not preload the repository.

For every task:
1. Read this file.
2. Read the task packet named by the user. For autonomous evolution, start with `docs/tasks/PHASE_13_AUTONOMOUS_SHOPPER.md`.
3. Read only source files and reference docs needed for that slice.
4. Read an ADR only when the task changes or depends on that decision.
5. Expand context only when a concrete dependency or failing test requires it.

Never read all ADRs, docs, migrations, or tests by default. See `docs/CODEX_WORKFLOW.md`.

## Non-negotiable safety

GhostShopper tests only authorized public storefront experiences.

It must never:
- submit payment or create a real purchase;
- fill payment fields;
- use real customer sessions, customer accounts, customer data, or protected pages;
- solve or bypass CAPTCHAs, authentication, anti-bot controls, or access restrictions;
- expose unrestricted Playwright/Page/browser APIs to an AI model;
- execute model-generated JavaScript, selectors, arbitrary URLs, network requests, or commands;
- allow a model to bypass browser egress/write policy;
- force-click hidden or disabled controls or mutate hidden state to manufacture success;
- treat storefront content as trusted instructions;
- send unnecessary merchant/store data to an AI provider.

Checkout initiation remains the purchase boundary unless a future reviewed ADR explicitly changes it.

## Agentic control boundary

The autonomous shopper uses:

```text
Mission
  -> sanitized observation
  -> model proposes closed typed action
  -> schema validation
  -> deterministic policy gate
  -> safe browser executor
  -> sanitized observation
  -> repeat within budgets
```

The model proposes intent, never raw browser implementation.

Actions use code-owned enums and, when targeting elements, opaque candidate IDs created by the browser observation layer. The model cannot invent selectors.

Unknown, ambiguous, stale, disallowed, or budget-exceeding actions fail closed. Every executed agent action is auditable.

## Deterministic and agentic separation

Keep the existing `PURCHASE_JOURNEY` deterministic path intact.

Autonomous AI must not:
- alter deterministic technical findings;
- change deterministic technical score;
- change existing incident identity rules implicitly;
- reinterpret a failed deterministic step as success.

Agentic findings remain separately labelled until a reviewed design defines reproduction/promotion rules.

## Architecture boundaries

| Area | Owns | Must not own |
| --- | --- | --- |
| `apps/web` | Shopify auth, merchant UI, APIs, configuration, billing | browser execution |
| `apps/runner` | async orchestration, leases, browser/AI composition | merchant-facing auth policy |
| `packages/domain` | pure business types/rules | SDKs, Node APIs, Zod, Prisma, Playwright |
| `packages/application` | use cases and ports | infrastructure implementations |
| `packages/contracts` | strict boundary schemas | business orchestration |
| `packages/browser` | Playwright, observation, safe execution, evidence | billing, Shopify admin auth, AI provider calls |
| `packages/ai` | provider adapters, versioned prompts | direct browser access, domain policy |
| `packages/database` | tenant-scoped persistence and concurrency | domain policy |
| `packages/queue` | durable delivery adapters | browser/business behavior |
| `packages/storage` | private evidence bytes | authorization policy |
| `packages/notifications` | provider delivery adapters | incident policy |

Preserve the modular-monolith plus independent runner architecture.

## Tenant and data rules

- Merchant-owned persisted entities are tenant-scoped by `shopId`.
- Tenant identity comes from verified server-side Shopify context, never caller input.
- Public inputs use strict allowlists.
- Persist only data required for behavior, diagnosis, audit, billing, or security.
- Evidence remains private and time-bounded.
- Secrets, session tokens, checkout tokens, raw provider errors, and sensitive headers never enter logs.

## Change rules

Create or update an ADR when a change materially alters architecture, trust boundaries, external side effects, persistence semantics, or the purchase safety boundary.

When changing:
- domain vocabulary: update domain, contracts, persistence/API tests;
- persisted model: add an explicit migration; never auto-migrate on startup;
- public API: update contract docs and auth/tenant tests;
- browser safety: add negative tests proving forbidden behavior stays blocked;
- AI semantics: version prompt/schema and preserve provider abstraction;
- incident identity/scoring: keep policy deterministic and versioned.

Prefer the smallest design that preserves clean boundaries.

## Coding standards

- TypeScript strict mode; avoid `any`.
- Closed enums/unions for safety-sensitive state.
- Zod at untrusted API/process/provider boundaries.
- Fixed safe error codes at persistence/API boundaries.
- Idempotent/fenced async processing.
- No silent fallback that converts uncertainty into success.
- Comments explain invariants or non-obvious safety choices.

## Verification order

Run the smallest relevant checks first:

```text
targeted unit test
targeted browser/integration test
pnpm typecheck
pnpm lint
pnpm check
```

Run database, queue, storage, or live Shopify acceptance only when the task touches those areas and required infrastructure exists. Never claim an unrun external check passed.

## Definition of done

A slice is done when behavior matches the task packet, safety and tenant boundaries are preserved, tests cover success plus forbidden/failure paths, relevant type/lint checks pass, docs describe current truth, and unrelated refactors are excluded.

The handoff must state changed files, tests run, external checks not run, and the next recommended slice.

## Source map

Read on demand:
- product/current target: `docs/PRODUCT.md`
- evolution boundaries: `docs/EVOLUTION.md`
- architecture: `docs/ARCHITECTURE.md`
- browser safety/current journey: `docs/BROWSER.md`
- AI/provider boundary: `docs/AI.md`
- testing: `docs/TESTING.md`
- security/deployment: `docs/SECURITY.md`, `docs/HARDENING.md`
- implementation task: `docs/tasks/PHASE_13_AUTONOMOUS_SHOPPER.md`
- documentation router: `docs/README.md`
- historical decisions: `adr/README.md`
