# Phase 13 — autonomous shopper foundation

Status: planned. Nothing in this file is implemented merely because it is described here.

Goal: add a bounded AI-directed exploration path while preserving the existing deterministic `PURCHASE_JOURNEY`.

Implement these slices in order unless a dependency forces a smaller prerequisite.

## 13.1 Agent domain and contracts

### Objective

Define the infrastructure-free vocabulary for missions, observations, decisions, actions, budgets, and agent-run outcomes.

### Required reads

- `AGENT.md`
- `docs/EVOLUTION.md`
- `packages/domain/src/journey.ts`
- `packages/domain/src/index.ts`
- `packages/contracts/src/journey.ts`

### Allowed scope

Primarily `packages/domain`, `packages/contracts`, and exact unit tests.

### Required design

Introduce closed concepts without changing `PURCHASE_JOURNEY`.

Model at least:

- mission identity/type/goal;
- bounded agent budgets;
- observation identity/version;
- safe interaction candidates;
- closed shopper decisions/actions;
- explicit stop reasons/outcomes.

Candidate-targeting actions reference opaque candidate IDs, never selectors.

### Non-goals

No OpenAI call. No Playwright agent execution. No database migration. No UI.

### Acceptance

- domain remains infrastructure-free;
- contracts reject unknown action types/fields;
- arbitrary selector/script/URL fields are impossible in the accepted decision shape;
- invalid budgets and stale/malformed identifiers fail validation;
- current journey tests remain unchanged and green.

## 13.2 Browser observation and safe candidate model

### Objective

Teach the browser package to describe a page without giving a model raw browser control.

### Required reads

- `packages/browser/src/engine.ts`
- `packages/browser/src/actions.ts`
- `packages/browser/src/locators.ts`
- `packages/browser/src/safety.ts`
- Phase 13.1 types/contracts

### Required design

Produce a bounded observation containing only approved facts.

Interactive candidates receive short-lived opaque IDs bound to the current observation.

Candidate metadata may include safe fields such as role, bounded accessible name, enabled/visible state, semantic category, and selected state.

The resolution map stays inside the browser package and expires when the observation changes.

### Safety acceptance

- no raw DOM/HTML is required by the contract;
- no selector is exposed to the model-facing boundary;
- stale/unknown candidates are rejected;
- hidden/disabled controls are not executable;
- existing egress/write restrictions remain unchanged;
- prompt-like storefront text cannot become code or policy.

### Non-goals

No model/provider call. No autonomous loop.

## 13.3 Policy-gated semantic executor

### Objective

Execute one validated shopper action through deterministic policy.

### Required design

Create a code-owned policy layer between decision validation and Playwright.

It checks:

- action is supported in current state;
- target candidate belongs to current observation;
- navigation stays allowed;
- cart write budget is available;
- checkout boundary is respected;
- run/action/time budgets remain;
- repeated rejected decisions are bounded.

The executor returns structured success/rejection/failure results.

### Acceptance

Negative tests prove attempts to use stale candidates, unsupported actions, hidden/disabled targets, unsafe navigation, excess writes, and post-checkout actions fail closed.

Existing deterministic executor remains independent.

## 13.4 Shopper model port and provider adapter

### Objective

Allow a model to choose one safe action from a sanitized observation.

### Required reads

- current `packages/ai` provider abstraction;
- `docs/AI.md`;
- Phase 13.1–13.3 contracts.

### Required design

Application owns the shopper-agent port. `packages/ai` implements a provider adapter.

Use strict structured output. Version prompt/schema semantics.

Input contains only bounded mission/history/observation data approved by contract.

Output is exactly one validated decision.

No tool access is given to the model.

### Acceptance

Tests cover malformed output, unknown action, stale candidate reference, refusal, timeout, rate limit, prompt-injection text in observation, and token/cost accounting.

AI failure cannot weaken browser policy.

## 13.5 Bounded agent run loop

### Objective

Compose observation -> decision -> policy -> execution in the runner.

### Required design

Agentic execution is a separate scenario/run mode from `PURCHASE_JOURNEY`.

Each step records:

- observation/version reference;
- proposed action;
- policy result;
- execution result;
- timings;
- safe reason/stop code;
- cost/usage reference where applicable.

Termination includes success/goal reached, shopper stop, policy exhaustion, action budget, time budget, provider failure, browser failure, checkout boundary, or cancellation.

### Acceptance

- loops are bounded even with a pathological model;
- duplicate queue delivery cannot create duplicate uncontrolled side effects;
- cancellation closes browser resources;
- deterministic runs are unchanged;
- evidence/history is sufficient to explain the path.

Persistence changes require explicit migration and tenant tests.

## 13.6 Curated missions and personas

### Objective

Expose useful merchant-facing missions without making merchants write test scripts.

Start with curated mission templates. Natural-language merchant missions may compile into the same closed mission contract after validation.

Example future personas:

- first-time shopper;
- impatient mobile shopper;
- bargain hunter;
- indecisive comparison shopper.

### Boundaries

Persona text changes goals/preferences, not capabilities. A persona can never relax policy.

Do not add broad catalog/admin scopes unless a concrete mission requires them and the scope change is reviewed.

## 13.7 Discovery reproduction

### Objective

Turn a valuable discovery into a reproducible bounded mission.

Do not merge this into early agent-loop work.

A reproduction must capture stable intent/action facts without storing selectors or sensitive page content.

Only reproduced/code-classified failures should be candidates for durable regression/incident promotion.

## Deferred beyond Phase 13

- automatic triggering from theme/app changes;
- broad store-intelligence/catalog planning;
- cross-market/currency matrices;
- automatic fixes;
- deterministic-incident promotion policy for agent findings;
- multi-commerce support.

## Phase 13 completion gate

Phase 13 is complete only when an authorized test store can run at least one bounded autonomous mission that:

- chooses actions dynamically from observations;
- cannot escape the closed action/policy boundary;
- stops before payment;
- produces auditable action history/evidence;
- remains isolated by tenant;
- leaves existing deterministic monitoring behavior intact.

Live provider/store acceptance must be reported separately from fixture/unit success.
