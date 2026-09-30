# Architecture decision records

Record significant choices here. Accepted decisions reflect [AGENT.md](../AGENT.md); future changes must explain consequences and require approval when materially changing the specified architecture.

| ADR                                                                     | Status                            |
| ----------------------------------------------------------------------- | --------------------------------- |
| [0001 Modular monolith](0001-modular-monolith.md)                       | Accepted                          |
| [0002 Browser worker separation](0002-browser-worker-separation.md)     | Accepted                          |
| [0003 BullMQ job queue](0003-bullmq-job-queue.md)                       | Accepted; implementation deferred |
| [0004 AI provider abstraction](0004-ai-provider-abstraction.md)         | Accepted; implemented in Phase 8  |
| [0005 S3 artifact storage](0005-s3-artifact-storage.md)                 | Accepted; implemented in Phase 5  |
| [0006 Deterministic/AI separation](0006-deterministic-ai-separation.md) | Accepted; implemented in Phase 8  |
| [0007 Shopify shell](0007-shopify-shell.md)                             | Accepted                          |
| [0008 Monitoring persistence](0008-monitoring-persistence.md)           | Accepted                          |

See also [0009 Durable run dispatch](0009-durable-run-dispatch.md) (Accepted).
See also [0010 Browser journey engine](0010-browser-journey-engine.md) (Accepted).
See also [0011 Private evidence lifecycle](0011-private-evidence-lifecycle.md) (Accepted).
See also [0012 Deterministic technical analysis](0012-deterministic-technical-analysis.md) (Accepted).
See also [0013 Atomic incident lifecycle](0013-atomic-incident-lifecycle.md) (Accepted).
See also [0014 Optional AI analysis](0014-optional-ai-analysis.md) (Accepted).

Use [the template](template.md) for new decisions. Do not silently rewrite accepted decisions.
