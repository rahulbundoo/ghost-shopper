# Product

## Vision

GhostShopper detects failures and friction in Shopify storefront purchase journeys through deterministic browser checks, evidence and separately labelled optional AI interpretation.

## V1 journey

Home → find product → open product → select variant → add to cart → open cart → begin checkout → stop. Never submit payment or create a real customer purchase.

## Delivery status

Phases 0–3 provide repository tooling, the Shopify shell, tenant-scoped persistence and asynchronous dispatch. Phase 4 implements bounded desktop/mobile browser journeys and persisted step results, stopping at checkout initiation. Controlled browser fixtures are verified; real-store acceptance requires an authorized development storefront, Shopify credentials, PostgreSQL and Redis. Monitor frequency remains configuration only. See [browser limits](BROWSER.md) and [AGENT.md](../AGENT.md).

## Deferred

Phase 5 implements evidence capture, private storage metadata and authenticated download APIs. Phase 6 implements deterministic technical findings, severity, scores and fingerprints. Phase 7 implements incident creation, deduplication, occurrence counting and resolution/reopening with authenticated read APIs. Phase 8 adds optional, explicitly enabled AI experience analysis with validated findings, version metadata and token/cost tracking, independent of technical monitoring. Dashboards, recurring scheduling, alerts and billing remain deferred. No production readiness, model-quality guarantee or broad storefront compatibility is claimed. See [AI limits](AI.md), [incident rules](INCIDENTS.md), [analysis rules](ANALYSIS.md) and [evidence acceptance](EVIDENCE.md).
