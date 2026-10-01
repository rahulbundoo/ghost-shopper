# Domain

`packages/domain` contains infrastructure-free business concepts and policy.

It must not import Shopify, Playwright, Prisma, Redis/BullMQ, AI SDKs, Zod, React, Node APIs, or storage/provider SDKs.

## Current terminology

- **Shop** — installed Shopify merchant/store.
- **Monitor** — recurring configured deterministic check.
- **Scenario** — reusable execution mode; currently `PURCHASE_JOURNEY`.
- **TestRun** — one execution snapshot of one monitor.
- **RunStep** — one deterministic journey action result.
- **Finding** — one classified technical problem.
- **Incident** — persistent/recurrent deterministic problem identity.
- **Artifact** — private evidence metadata.
- **AiAnalysis** — separately labelled subjective post-run AI interpretation.
- **Subscription / UsageRecord** — billing access/allowance concepts.

Merchant-owned persisted entities remain tenant-scoped by `shopId`.

## Current invariants

- monitor configuration is snapshotted into a run;
- run state/outcomes use closed vocabularies;
- deterministic finding types/severity/scoring are code-owned;
- incomplete evidence does not become a perfect score;
- incident identity is stable and does not depend on free-form AI text;
- AI analysis never mutates deterministic incident/scoring policy;
- infrastructure locking, hashing, HTTP, credentials, and SDK details stay outside domain.

## Planned Phase 13 terminology

The autonomous evolution may add infrastructure-free concepts such as:

- **ShopperMission** — bounded shopper goal/persona constraints;
- **BrowserObservation** — sanitized versioned view of current storefront state;
- **InteractionCandidate** — short-lived opaque target the model may reference;
- **ShopperDecision** — one structured model decision;
- **ShopperAction** — closed semantic action intent;
- **AgentBudget** — code-owned run/action/provider limits;
- **AgentRunStep** — audited observation/decision/policy/execution result;
- **AgentStopReason** — explicit bounded terminal reason.

Exact names may change during Phase 13.1, but the trust boundary may not: domain describes intent/policy, not Playwright selectors or provider SDK payloads.

## Deterministic separation

Do not overload existing `RunStep` or technical `Finding` semantics merely to fit autonomous data.

Agentic runs must remain distinguishable from `PURCHASE_JOURNEY`. Promotion of reproduced agent discoveries into durable incidents is deferred to a reviewed later phase.

## Boundary rules

Untrusted inputs are validated in `packages/contracts`.

Application owns ports/use cases. Database/browser/AI packages implement adapters.

If Phase 13 introduces persisted mission/action history, add tenant-scoped database constraints and explicit migrations rather than pushing persistence concerns into domain.

See `EVOLUTION.md` and the Phase 13 task packet.
