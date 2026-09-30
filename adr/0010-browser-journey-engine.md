# 0010 — Bounded browser journeys and checkout safety

Status: Accepted within Phase 4 of AGENT.md.

## Context

Phase 3 provides asynchronous execution and fenced persistence. Phase 4 must perform real browser actions without coupling Playwright to web/domain, adding product scopes or risking order submission.

## Decision

Implement seven composable JourneyAction classes in the runner-only browser adapter, with an ordered semantic LocatorResolver. Use fresh Chromium contexts and processes for each run, desktop/mobile profiles, bounded discovery, exact product/variant checks and incremental tenant-scoped RunStep persistence. Failed actions produce fixed structured errors and skipped later steps. The runner connects the adapter to its existing JourneyExecutor port and lease-bound recorder.

Use only authenticated server-synchronized storefront origins. Public product/cart JSON validates actions; it never substitutes for clicking purchase controls. A per-run authenticated loopback CONNECT proxy pins public IPv4 resolutions for allowlisted hosts. This is an in-process safety helper, not a third deployed service. Redirects are handled without automatic following because Playwright does not re-route redirect hops. Confirm the checkout response but render only an inert replacement; never run checkout scripts or fill payment fields.

## Consequences

No architecture boundary or Shopify scope expansion. Playwright is the only new runtime library (Zod is reused). Local Chrome avoids another browser download. Tests use real Chromium with controlled upstream responses; real-store acceptance still requires authorized stores and configured services. Discovery/host/locator limits deliberately prefer explicit failures over unsafe guesses. Broad theme compatibility, streaming resource limits, external egress enforcement and evidence remain later work. This is not an exactly-once guarantee for external effects.
