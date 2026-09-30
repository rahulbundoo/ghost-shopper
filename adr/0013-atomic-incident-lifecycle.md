# 0013 Atomic incident lifecycle

- Status: Accepted
- Date: 2026-09-30
- Extends: ADR 0009 and ADR 0012

## Decision

Reconcile deterministic incidents atomically with run completion inside the existing PostgreSQL adapter. Serialize per monitor with a parameterized row lock and retain execution-lease fencing. Incident identity combines configuration scope and the existing finding fingerprint. Count distinct completed runs through unique occurrence records. Reopen the same incident on recurrence.

## Recovery policy

Only a complete zero-finding PASSED analysis establishes recovery for the same configuration and rules version. Stable run creation time/UUID ordering and a per-scope clean watermark handle out-of-order completions. Older failures still count but cannot reopen after newer recovery; older clean runs cannot resolve newer failures. Incomplete observations never prove recovery.

## Consequences

No new service, queue, dependency, AI call or notification workflow is introduced. Completion rollback preserves consistency if incident persistence fails. The runner uses existing terminal analysis/finalization error handling without automatic cart replay. Old configurations may retain open incidents until retested cleanly. V1 keeps lifetime occurrence history, not a separate episode/event-sourcing model.

## Verification

Pure rules, query-level reconciliation, ownership and authenticated API tests run without services. Dedicated PostgreSQL tests cover concurrency, rollback, ordering and cascades; live Shopify acceptance remains separate. See [incident lifecycle and operations](../docs/INCIDENTS.md).
