# Testing

Testing is layered so local feedback stays fast and external acceptance is not confused with unit success.

## Default verification

```bash
pnpm check
```

This covers builds, formatting checks, lint, strict TypeScript, unit tests, and compiled HTTP/integration tests that do not require external services.

Use targeted tests first during implementation.

## Test commands

| Command | Purpose | External dependency |
| --- | --- | --- |
| `pnpm test:unit` | domain/application/adapter unit behavior | none |
| `pnpm test:integration` | compiled app/HTTP integration | none |
| `pnpm test:browser` | real Chrome/Chromium against controlled storefront fixtures | browser |
| `pnpm test:database` | real persistence, constraints and concurrency | dedicated PostgreSQL |
| `pnpm test:queue` | BullMQ delivery + persistence behavior | PostgreSQL + Redis |
| `pnpm test:storage` | private S3-compatible artifact behavior | dedicated test bucket |
| `pnpm test:infra` | optional local/disposable infrastructure smoke tests | Docker services |
| `pnpm typecheck` | strict TypeScript | none |
| `pnpm lint` | lint/boundary rules | none |
| `pnpm security:check` | dependency audit | package metadata |

Do not provision infrastructure implicitly just to make a test pass.

## Acceptance levels

### Unit/fixture acceptance

Proves code rules and controlled behavior only.

It does not prove:
- live Shopify theme compatibility;
- provider quality;
- email delivery;
- real billing;
- cloud storage policy;
- production egress/sandbox isolation.

### Infrastructure acceptance

Database/queue/storage suites prove behavior against dedicated test services.

Use isolated test resources. Never point destructive tests at production.

### Live acceptance

Use only authorized Shopify development/test resources and explicitly configured external providers.

Report live acceptance separately. Never claim it based on mocks or fixtures.

## Current deterministic browser coverage

Browser fixtures should preserve coverage for:

- desktop/mobile contexts;
- exact seven-step order;
- supported variant selectors;
- one verified cart write;
- sold-out/missing products;
- invalid cart state;
- HTTP/browser failures;
- blocked navigation;
- timeout/cancellation;
- checkout initiation without payment.

Changes to the autonomous path must not regress these tests.

## Phase 13 testing rules

Each autonomous-shopper slice adds both positive and negative tests.

At minimum, the complete foundation must prove:

- model-facing decisions cannot contain executable selectors/scripts/URLs;
- stale or unknown candidate IDs are rejected;
- hidden/disabled/ambiguous interactions fail closed;
- unsafe navigation remains blocked;
- cart-write/action/time/provider budgets are enforced;
- post-checkout actions are rejected;
- prompt-like storefront content cannot bypass policy;
- pathological model output terminates within bounds;
- cancellation cleans browser resources;
- tenant persistence remains isolated;
- deterministic `PURCHASE_JOURNEY` behavior remains unchanged.

Provider quality and live exploratory usefulness require separate authorized acceptance.

## AI-agent workflow

For implementation tasks, follow `CODEX_WORKFLOW.md`:

1. exact/targeted tests;
2. relevant package type/lint checks;
3. broader `pnpm check`;
4. external suites only when required/configured.

The final handoff must list commands actually run and external checks not run.
