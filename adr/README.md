# Architecture decision records

ADRs are the historical decision archive. They are **not** default Codex startup context.

Read `../AGENT.md` first. Open only the ADR relevant to the architecture or trust boundary being changed.

| ADR | Decision |
| --- | --- |
| [0001](0001-modular-monolith.md) | Modular monolith |
| [0002](0002-browser-worker-separation.md) | Independent browser worker |
| [0003](0003-bullmq-job-queue.md) | BullMQ job queue |
| [0004](0004-ai-provider-abstraction.md) | AI provider abstraction |
| [0005](0005-s3-artifact-storage.md) | S3 artifact storage |
| [0006](0006-deterministic-ai-separation.md) | Deterministic/AI separation |
| [0007](0007-shopify-shell.md) | Shopify shell |
| [0008](0008-monitoring-persistence.md) | Monitoring persistence |
| [0009](0009-durable-run-dispatch.md) | Durable run dispatch |
| [0010](0010-browser-journey-engine.md) | Deterministic browser journey |
| [0011](0011-private-evidence-lifecycle.md) | Private evidence lifecycle |
| [0012](0012-deterministic-technical-analysis.md) | Deterministic technical analysis |
| [0013](0013-atomic-incident-lifecycle.md) | Atomic incident lifecycle |
| [0014](0014-optional-ai-analysis.md) | Optional post-run AI analysis |
| [0015](0015-durable-scheduling-alerts.md) | Scheduling and alerts |
| [0016](0016-billing-admission.md) | Shopify billing/run admission |
| [0017](0017-production-hardening.md) | Production safeguards |
| [0018](0018-agentic-shopper-control-boundary.md) | Policy-gated autonomous shopper control |

Use [the template](template.md) for a new material decision.

Do not silently rewrite accepted ADRs to match new code. Add a superseding ADR when a decision changes materially.
