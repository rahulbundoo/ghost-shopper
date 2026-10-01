# Product

## Vision

GhostShopper detects failures and friction in Shopify storefront purchase journeys through deterministic browser checks, evidence and separately labelled optional AI interpretation.

## V1 journey

Home → find product → open product → select variant → add to cart → open cart → begin checkout → stop. Never submit payment or create a real customer purchase.

## Delivery status

Phases 0–3 provide repository tooling, the Shopify shell, tenant-scoped persistence and asynchronous dispatch. Phase 4 implements bounded desktop/mobile browser journeys and persisted step results, stopping at checkout initiation. Controlled browser fixtures are verified; real-store acceptance requires an authorized development storefront, Shopify credentials, PostgreSQL and Redis. Phase 10 activates saved monitor frequency when deployment scheduling is enabled. See [browser limits](BROWSER.md) and [AGENT.md](../AGENT.md).

## Additional implemented phases and remaining work

Phase 5 implements evidence capture, private storage metadata and authenticated download APIs. Phase 6 implements deterministic technical findings, severity, scores and fingerprints. Phase 7 implements incident creation, deduplication, occurrence counting and resolution/reopening with authenticated read APIs. Phase 8 adds optional, explicitly enabled AI experience analysis with validated findings, version metadata and token/cost tracking, independent of technical monitoring. Phase 9 adds the merchant overview, monitor create/edit/disable, run history/details, incident history/details, findings and private evidence access. Phase 10 adds recurring scheduling, non-overlapping manual runs, merchant email opt-in, significant incident and recovery notifications, cooldowns and bounded delivery retries. Phase 11 adds a configurable trial, one Shopify recurring plan, verified subscription state and atomic run limits. Production hardening remains deferred. No production readiness, live billing acceptance, inbox-delivery guarantee, model-quality guarantee or broad storefront compatibility is claimed. See [billing activation and limits](BILLING.md), [automation activation and limits](AUTOMATION.md), [merchant UI limits](MERCHANT_UI.md), [AI limits](AI.md), [incident rules](INCIDENTS.md), [analysis rules](ANALYSIS.md) and [evidence acceptance](EVIDENCE.md).
