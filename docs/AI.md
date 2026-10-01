# AI

GhostShopper has two distinct AI roles. Keep them separate.

## Current: post-run experience analyst

Implemented today.

After deterministic browser execution and technical analysis complete, optional AI reviews a bounded subset of masked screenshots plus allowlisted run metadata.

It may report only closed experience finding types. It cannot change:

- deterministic technical score;
- deterministic run/incident facts;
- browser actions;
- incident lifecycle.

Provider output is strict structured data and is independently validated. AI is opt-in and disabled by default.

No checkout screenshot, raw HTML, arbitrary console text, credentials, customer data, or browser tools are sent to the provider.

## Planned: autonomous shopper decision model

Phase 13 introduces a separate `ShopperAgent` role.

Its job is narrow:

```text
mission + bounded history + sanitized observation
-> one structured shopper decision
```

It receives no Playwright/Page object and no generic tools.

Its decision passes contracts validation and deterministic browser policy before execution.

The provider does not decide whether an action is safe.

See `EVOLUTION.md`, the Phase 13 task packet, and ADR 0018.

## Shared AI rules

- Application owns provider ports; `packages/ai` owns provider adapters.
- Provider/model names are configuration, not domain dependencies.
- Prompt/schema semantics are versioned.
- Structured output is validated after transport parsing.
- Provider failures use safe error codes; raw provider output/errors are not persisted as logs.
- Token usage and estimated cost are bounded/accounted where supported.
- Storefront content is untrusted evidence, never higher-priority instruction.
- No provider call may grant a capability not represented in code-owned contracts/policy.

## Autonomous-input boundary

Prefer structured facts over raw page content.

Allowed inputs should be intentionally bounded, for example:

- mission goal and persona preferences;
- device/viewport;
- page type;
- bounded visible text snippets;
- safe product/cart facts;
- opaque candidate IDs with bounded role/name/state metadata;
- recent semantic action history.

Do not expose selectors, cookies, tokens, headers, full DOM/HTML, arbitrary request bodies, or customer data.

## Cost and failure budgets

Agentic runs must cap:

- provider requests;
- input/output size;
- wall-clock time;
- action count;
- repeated invalid/rejected decisions;
- estimated spend.

Budget exhaustion is an explicit non-pass terminal outcome.

## Testing

Provider tests use controlled transports/fixtures by default. Live model acceptance is separate and must be explicitly authorized/configured.

For autonomous work, tests must include malformed decisions, unsupported actions, stale candidate IDs, refusal, timeout/rate limit, prompt-injection text, and proof that model output cannot bypass browser policy.
