# Domain

## Reserved terminology

Shop, Monitor, Scenario, TestRun, RunStep, Finding, Incident and Artifact have the meanings defined in [AGENT.md](../AGENT.md). Merchant-owned entities require shopId; tenant context must come from server-side authentication.

## Implementation status

Phase 2 defines infrastructure-free Shop, Monitor, TestRun and JourneyConfiguration types, closed scenario/device/frequency/run-state vocabularies, active-shop rules and enabled-monitor snapshots. Domain imports no frameworks, validation library, Node APIs or database code.

Contracts validates unknown boundary inputs with strict Zod schemas, rejecting caller-owned tenant IDs, entity IDs, run statuses and unsupported scenarios. Application owns repository ports and MonitoringService use cases. Database implements these ports with tenant-bound Prisma repositories; web supplies tenant context exclusively from authenticated Shopify sessions.

Monitor snapshots keep a TestRun's execution inputs independent of subsequent configuration edits. A run starts QUEUED with no outcome. Phase 3 validates QUEUED → RUNNING → COLLECTING → ANALYZING → COMPLETED, with ERROR/CANCELLED exits and bounded active-to-QUEUED retries. Terminal states cannot restart. Infrastructure leases and fencing live in the database adapter, not the domain. No public generic state-mutation endpoint exists.

## Planned rules

Run lifecycle states and terminal outcomes must be explicit types. Deterministic findings remain separate from AI interpretation. Incident deduplication uses stable identifiers and taxonomy, never free-form AI descriptions.

Validation, active-shop/enabled-monitor rules, immutable snapshots, tenant isolation, transitions and concurrent monitor edits have tests. Phase 4 adds ActionResult and RunStep: seven closed action names, PASSED/FAILED/SKIPPED statuses, start/end/duration, sanitized URL and closed error codes. RunStep includes tenant/run/attempt identity. Phase 5 adds Artifact metadata, closed SCREENSHOT/TRACE/CONSOLE/NETWORK/METADATA types, PENDING/READY/FAILED upload states and infrastructure-free captured byte payloads. Application owns evidence repository/storage ports.

Phase 6 adds Finding/RunAnalysis, eleven closed technical finding types, severity mapping, pure analysis/scoring and canonical fingerprint identity rules. Domain returns stable identity text; the database adapter supplies SHA-256 without introducing Node crypto into domain. Technical Finding uses source DETECTED. Incomplete analysis has a null score. See [versioned rules](ANALYSIS.md).

Phase 7 adds Incident/IncidentOccurrence, closed OPEN/RESOLVED states, configuration-scope identity, stable observation ordering and a conservative recovery predicate. Complete zero-finding passes can resolve incidents; other outcomes cannot. Repeated runs increment lifetime occurrence counts; recurrence reopens the same identity. Infrastructure locks, hashing and idempotent writes remain in the database adapter. See [incident semantics](INCIDENTS.md).

Phase 8 adds JourneyAnalysisInput, JourneyAnalysis, ExperienceFinding, AiUsage and AiAnalysisRecord. Five closed experience types have code-owned noncritical severity rules. AI_ANALYSIS records carry a separate subjective score and never enter technical scoring or incident reconciliation. Provider names, version metadata and cost records are data, not infrastructure dependencies. Application owns provider/persistence ports; domain remains SDK/Node/Zod-free. See [AI analysis](AI.md).
