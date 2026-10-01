# Autonomous mystery-shopper evolution

## Why the product is evolving

The current GhostShopper implementation is a strong deterministic synthetic monitor. It verifies a configured Shopify product journey from storefront entry to checkout initiation and produces evidence, findings, incidents, schedules, alerts, and billing support.

That remains useful.

The evolution adds a second capability: **bounded autonomous exploration** that can discover problems a merchant did not preconfigure.

The product becomes:

```text
Known critical path monitoring
+
Unknown-friction discovery
```

## Product model

### Deterministic monitor

Best for:
- known products/variants;
- repeatable uptime/regression checks;
- stable incident identity;
- high-confidence technical failure detection.

### Autonomous mystery shopper

Best for:
- exploratory customer behavior;
- search/navigation/cart friction;
- store-specific interactions;
- realistic personas and missions;
- discovering unknown failure paths.

Neither replaces the other.

## Target agent loop

```text
Mission
  -> Store/mission context
  -> Browser produces sanitized observation + safe candidates
  -> Shopper model selects one closed semantic action
  -> Contract validation
  -> Deterministic policy/budget gate
  -> Browser executes action
  -> Evidence/result recorded
  -> Loop or stop
  -> Evaluator
  -> Reproduction/regression pipeline
```

The model never owns browser policy.

## Trust boundary

Storefront content is untrusted evidence. It may contain prompt injection, misleading labels, user-generated content, or hostile text.

The model receives a bounded representation. Browser actions are constrained by code.

For interactive elements, the observation layer exposes short-lived opaque candidate IDs and safe metadata. The model chooses candidate IDs; it cannot submit selectors.

Candidate IDs are valid only for the observation that produced them. Stale IDs fail closed.

## Initial semantic action vocabulary

The final vocabulary should stay small and task-oriented. Phase 13 may introduce a subset first.

Expected concepts include:

- OPEN_HOME
- OPEN_CANDIDATE
- SEARCH
- SELECT_OPTION
- SET_QUANTITY
- ADD_TO_CART
- OPEN_CART
- REMOVE_FROM_CART
- GO_BACK
- CONTINUE_SHOPPING
- BEGIN_CHECKOUT
- STOP

The exact union is code-owned and versioned. Arbitrary script execution is never an action.

## Budgets

Agentic runs require deterministic limits, including:

- maximum actions;
- maximum wall-clock time;
- maximum consecutive invalid/rejected decisions;
- maximum navigations;
- maximum allowed cart writes;
- maximum AI requests;
- token/cost ceiling;
- evidence limits.

Budget exhaustion returns an explicit bounded outcome, never PASS.

## Data minimization

Observations should prefer structured visible facts over raw HTML.

Do not send:
- customer/session data;
- cookies/tokens;
- checkout tokens;
- request/response headers or bodies;
- arbitrary console content;
- complete DOM/HTML by default.

Prefer:
- page class/type;
- normalized visible text snippets with strict caps;
- safe product/cart facts;
- candidate role/name/state metadata;
- viewport/device;
- bounded screenshot evidence where explicitly enabled.

## Prompt-injection handling

System and mission rules always outrank storefront content.

Storefront text is labelled as untrusted observation. Instructions found inside the store do not grant capabilities or modify safety policy.

Policy enforcement is outside the model, so a successful prompt injection still cannot create a forbidden browser action.

## Findings and incidents

During Phase 13, agentic observations/findings remain separate from deterministic technical findings.

Do not automatically open existing deterministic incidents from a subjective or one-off agent interpretation.

Longer term:

```text
agent discovers issue
-> recorded mission/action history
-> reproduce under bounded conditions
-> classify stable failure
-> optionally create regression monitor/incident
```

Promotion rules require their own reviewed design.

## Evolution stages

### Phase 13 — safe autonomous foundation

Build the closed mission/observation/decision/action architecture and run a bounded agent loop without weakening the deterministic journey.

Detailed slices: `tasks/PHASE_13_AUTONOMOUS_SHOPPER.md`.

### Phase 14 — reproducible mystery shopping

Add mission replay, issue reproduction, stable agentic finding identity, and regression conversion.

### Phase 15 — store intelligence and personas

Add richer mission generation from store structure and merchant goals. Introduce curated personas such as first-time, bargain, indecisive, and impatient mobile shoppers.

### Phase 16 — change-aware regression

Trigger risk-based missions after supported meaningful storefront changes. This requires separately reviewed Shopify scopes/webhooks and must not be smuggled into Phase 13.

## Not part of Phase 13

Do not add merely because it fits the long-term vision:

- real payment/order completion;
- customer account login;
- real-customer session capture;
- automatic storefront fixes;
- autonomous theme edits;
- arbitrary third-party browsing;
- broad new Shopify scopes without a reviewed need;
- app-install/theme-change triggers;
- multi-commerce support;
- custom model training;
- unbounded agent memory.

## Success criteria for the evolution

The autonomous shopper is valuable only if it is:

- safer than unrestricted browser agents;
- capable of store-specific exploration beyond a fixed script;
- reproducible enough to explain what happened;
- cost-bounded;
- tenant-safe;
- useful without requiring merchants to author test scripts.

Novelty is not a success criterion. Reliable discovery of revenue-impacting friction is.
