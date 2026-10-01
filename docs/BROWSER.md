# Browser

## Current deterministic engine

`packages/browser` owns Playwright execution. `apps/web` never runs a browser.

The implemented `PURCHASE_JOURNEY` performs seven ordered actions:

1. OPEN_HOME
2. FIND_PRODUCT
3. OPEN_PRODUCT
4. SELECT_VARIANT
5. ADD_TO_CART
6. OPEN_CART
7. BEGIN_CHECKOUT

It then stops. No checkout fields or payment controls are used.

The journey is intentionally deterministic and remains separate from planned autonomous exploration.

## Current safety boundary

Each run uses an isolated browser context/process and bounded timeouts.

The engine constrains:

- public HTTPS storefront destinations;
- navigation origin;
- allowed CDN hosts;
- service workers/WebSockets/downloads/permissions/popups;
- writes to the verified cart-add and checkout-initiation paths;
- checkout behavior;
- safe persisted URLs and error messages.

The runner uses a restricted per-run egress proxy and rejects unsafe/private address resolution.

It does not force-click, manipulate hidden variant state, solve challenges, or use AI to choose deterministic controls.

A pass means only that the configured bounded path reached checkout initiation.

## Planned autonomous browser path

Phase 13 does not turn the existing journey into an AI loop.

It adds browser primitives for:

1. producing a sanitized observation;
2. producing short-lived safe interaction candidates;
3. resolving opaque candidate IDs internally;
4. applying deterministic action/budget policy;
5. executing one semantic action;
6. recording a safe result.

Conceptually:

```text
page
-> observation + candidate map
-> external decision
-> validated semantic action
-> ActionPolicy
-> internal candidate resolution
-> Playwright
```

The candidate map never leaves the browser execution boundary as selectors.

## Candidate requirements

A model-facing candidate may contain only bounded safe metadata such as:

- opaque candidate ID;
- semantic role/category;
- bounded accessible label;
- visible/enabled/selected state;
- option/value metadata when explicitly safe.

Candidate IDs are tied to the observation that produced them.

Unknown/stale candidates fail closed. The executor revalidates current state before interaction.

## Autonomous action policy

The browser policy, not AI, determines whether an action is executable.

It enforces at least:

- supported action for current page/run state;
- valid current candidate;
- same-origin/navigation rules;
- allowed write type/count;
- checkout terminal boundary;
- maximum actions/time/navigations;
- cancellation/lease ownership.

A model cannot relax policy through its reasoning or storefront text.

## Local verification

Use installed Chrome if configured:

```bash
BROWSER_CHANNEL=chrome pnpm test:browser
```

The fixture suite exercises the real browser engine against controlled upstream responses without requiring a live Shopify store.

Live-store acceptance is separate and must use an authorized development storefront. Never infer broad Shopify/theme compatibility from fixtures.

## Compatibility

The deterministic journey deliberately fails closed on unsupported or ambiguous storefront behavior.

The autonomous evolution may improve compatibility by reasoning over safe observations, but must not weaken network/write/payment safeguards to do so.

Detailed evidence/privacy rules are in `EVIDENCE.md`. Deployment browser controls are in `HARDENING.md`.
