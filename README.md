# GhostShopper

GhostShopper is a Shopify app for synthetic shopping and AI mystery shopping.

## Current product

The implemented system runs a deterministic public-storefront journey:

```text
home -> find configured product -> open product -> select variant
-> add to cart -> open cart -> begin checkout -> stop
```

It includes desktop/mobile browser execution, evidence, deterministic findings, incidents, optional post-run AI experience analysis, scheduling, alerts, merchant UI, billing foundation, and production-hardening controls.

It never submits payment.

## Evolution

GhostShopper is evolving into a hybrid system:

- **deterministic monitors** for known repeatable purchase paths;
- **autonomous mystery shoppers** for bounded exploratory customer behavior.

The autonomous path is planned work. It does not replace the deterministic journey.

Read:
- [Product](docs/PRODUCT.md)
- [Evolution boundaries](docs/EVOLUTION.md)
- [Phase 13 task](docs/tasks/PHASE_13_AUTONOMOUS_SHOPPER.md)

## AI coding workflow

Codex/AI agents should start with:

1. [AGENTS.md](AGENTS.md)
2. [AGENT.md](AGENT.md)
3. the current task packet

Do **not** preload all documentation or ADRs. Use the [documentation router](docs/README.md) and [Codex workflow](docs/CODEX_WORKFLOW.md).

A reusable implementation prompt is in [docs/prompts/AUTONOMOUS_EVOLUTION_PROMPT.md](docs/prompts/AUTONOMOUS_EVOLUTION_PROMPT.md).

## Architecture

Two deployables:

- `apps/web` — Shopify integration, authenticated merchant UI/API, configuration and billing.
- `apps/runner` — queued browser execution, evidence, analysis, scheduling and notifications.

Internal workspace packages keep domain, application, contracts and adapters separated. See [architecture](docs/ARCHITECTURE.md).

## Local commands

Requires Node 22.15+ and pnpm 10.34.6.

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm dev:runner
pnpm test:browser
pnpm check
```

PostgreSQL/Redis/storage are required only for the flows that depend on them. See [testing](docs/TESTING.md), [runner setup](docs/RUNNER.md), and [Shopify setup](docs/SHOPIFY_SETUP.md).

## Safety

Public authorized storefronts only. No payment submission, real-customer sessions, CAPTCHA bypass, or unrestricted AI browser control.

The planned autonomous shopper must use validated semantic actions through a deterministic policy gate. See [ADR 0018](adr/0018-agentic-shopper-control-boundary.md).
