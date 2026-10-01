# Product

## Vision

GhostShopper helps Shopify merchants discover purchase friction before customers do.

The product has two complementary modes:

- **Deterministic monitoring** — repeatable verification of known purchase journeys.
- **Autonomous mystery shopping** — bounded exploration of customer behavior that merchants did not explicitly script.

## Current implementation

Today GhostShopper implements the deterministic mode.

The active journey is:

```text
OPEN_HOME
-> FIND_PRODUCT
-> OPEN_PRODUCT
-> SELECT_VARIANT
-> ADD_TO_CART
-> OPEN_CART
-> BEGIN_CHECKOUT
-> STOP
```

The merchant configures a product, optional variant, device, and frequency.

Implemented supporting capabilities include:

- Shopify installation/authentication and tenant-scoped persistence;
- asynchronous runner execution;
- Playwright desktop/mobile testing;
- screenshots/traces/diagnostics;
- deterministic findings, scoring, incidents, and recovery;
- optional post-run AI experience analysis;
- merchant UI;
- scheduling and email alerts;
- Shopify billing foundation;
- operational hardening controls.

A pass proves only the bounded tested path reached checkout initiation. It does not prove payment, every theme/app interaction, or whole-store health.

## Planned evolution

Phase 13 adds a separate autonomous run mode.

It will use:

```text
mission
-> sanitized observation
-> model proposes semantic action
-> validation + deterministic policy
-> safe browser execution
-> repeat within budgets
```

The model will not receive unrestricted Playwright access.

The deterministic `PURCHASE_JOURNEY` remains supported and is not converted into an AI-driven flow.

See:
- `EVOLUTION.md`
- `tasks/PHASE_13_AUTONOMOUS_SHOPPER.md`
- `../adr/0018-agentic-shopper-control-boundary.md`

## Product boundaries

GhostShopper does not:

- submit payment or intentionally create real orders;
- use real customer sessions/data;
- bypass authentication or anti-bot controls;
- automatically edit merchant storefronts;
- claim a subjective AI observation is a deterministic technical incident.

Future roadmap capabilities must be added explicitly and documented as implemented only after acceptance.
