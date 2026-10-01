# Documentation router

Use this page to avoid loading irrelevant context.

## Always start here

- `../AGENT.md` — engineering and safety contract.
- The task packet named in the prompt.

## Core current-state docs

| Need | Read |
| --- | --- |
| Product behavior and current vs target | `PRODUCT.md` |
| Autonomous evolution boundaries | `EVOLUTION.md` |
| System/package boundaries | `ARCHITECTURE.md` |
| Browser journey and purchase safety | `BROWSER.md` |
| AI roles/provider constraints | `AI.md` |
| Test commands and acceptance levels | `TESTING.md` |

## Read only when touched

- Shopify installation/auth: `SHOPIFY_SETUP.md`
- monitoring API: `MONITORING_API.md`
- domain semantics: `DOMAIN.md`
- findings/scoring: `ANALYSIS.md`
- evidence/privacy: `EVIDENCE.md`
- incidents: `INCIDENTS.md`
- scheduling/email: `AUTOMATION.md`
- billing: `BILLING.md`
- runner operations: `RUNNER.md`, `OPERATIONS.md`
- deployment/security: `SECURITY.md`, `HARDENING.md`
- merchant UI: `MERCHANT_UI.md`

## Historical decisions

`../adr/` is a decision archive. Do not read every ADR. Use `../adr/README.md` to locate only the decision relevant to the current change.

## AI implementation workflow

See `CODEX_WORKFLOW.md`. Autonomous evolution work is decomposed in `tasks/PHASE_13_AUTONOMOUS_SHOPPER.md`.
