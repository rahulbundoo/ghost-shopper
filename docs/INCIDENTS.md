# Incident lifecycle

Phase 7 groups recurring deterministic findings into persistent incidents. Repeated observations update one record, complete clean observations resolve it, and later recurrence reopens it. There are only two statuses: OPEN and RESOLVED. Email alerts, dashboards, manual acknowledgement and muting are not part of this phase.

## Identity and counts

An incident is unique by tenant, monitor, configuration scope and finding fingerprint. Configuration scope is a SHA-256 hash of `incident-scope-v1`, tenant, monitor, scenario, device, product, configured variant and analysis rules version. Renaming a monitor or changing frequency does not split incidents; changing the tested configuration or rules does. Finding fingerprints remain the Phase 6 stable identifiers, not hashes of prose.

Every finding in a newly COMPLETED run's current-attempt analysis can establish an incident, including findings from a WARNING or incomplete FAILED analysis. A conclusive observed finding is retained even when other evidence is missing. ERROR/CANCELLED runs and partial analyses that never reach COMPLETED do not change incidents. Runs without analysis do not establish incidents or recovery; historical data is not backfilled.

`occurrenceCount` counts distinct completed runs containing that finding, across all reopenings. One finding containing 200 repeated console events still adds only one incident occurrence. An IncidentOccurrence links the incident to its run, attempt and finding; database uniqueness prevents duplicate counts on redelivery. Recurrence reopens the existing incident ID, increments the lifetime count, and clears its current resolution reference. V1 does not retain a separate history of every open/resolve episode.

## Recovery and overlapping runs

Only a complete PASSED analysis with zero findings resolves incidents, and only within the same configuration scope. A WARNING, incomplete run, failed run, absent finding in a skipped step, monitor disable or uninstall does not prove recovery. Incidents belonging to old configurations remain until that same configuration produces a clean observation. Rules-version changes do not silently clear older incidents.

Observation ordering uses immutable run creation time, with canonical run UUID as the tie-breaker. This is request order, not completion time or proof of when a real-world defect changed. Each scope retains its newest clean observation. A clean run resolves only incidents whose latest finding observation is older; an older pass cannot erase a newer failure.

Late failures still count. If a newer clean run was already processed, a late failure creates an already-RESOLVED historical incident or adds an occurrence without reopening it. A newer failure after that clean run opens/reopens the incident. Therefore completion order cannot turn old evidence into a new alert condition. `firstSeenAt` and `lastSeenAt` are processing timestamps; `lastSeenRunCreatedAt` is the ordering timestamp. A late historical incident can have a resolution timestamp earlier than its first processing timestamp.

## Atomicity and ownership

The additive `202609300007_incidents` migration adds IncidentScope, Incident and IncidentOccurrence. IncidentScope stores the configuration's clean-run watermark even when no incident exists yet. The watermark ID is retained as ordering metadata, not an authorization mechanism. Compound foreign keys enforce tenant ownership of monitor, incident, run and finding relationships. Reads always enforce active tenant authentication.

PrismaRunStore takes a parameterized PostgreSQL row lock on the monitor, checks the current run lease/attempt/stage, and writes COMPLETED plus incident changes in one transaction. This serializes overlapping completions without changing monitor configuration, version or updatedAt. The transaction has a one-second connection-acquisition limit and five-second execution timeout. Uninstall or another owner invalidates the run predicate. Duplicate terminal delivery cannot reconcile again.

If reconciliation fails, completion and all incident writes roll back together. The runner reports terminal ANALYSIS_FAILED through its existing analysis/finalization failure handling without automatically replaying cart operations. Database unavailability can still prevent persisting the error state; existing lease recovery remains in force. These controls do not guarantee exactly-once external storefront effects after a process crash.

Uninstall blocks API access and cancels active leases but retains incident history. Verified shop redaction cascades scopes, incidents and occurrence records. Independent deletion of referenced runs requires an explicit retention policy; no run-retention sweeper is added. Counter consistency assumes occurrence rows are not independently deleted by an external operator.

## Read APIs

GET `/app/api/incidents` returns `{incidents}` and accepts optional monitorId, status (OPEN/RESOLVED), limit (default 25, maximum 100), and offset (default 0, maximum 100000). Results sort by lastSeenAt descending then ID descending.

GET `/app/api/incidents/:incidentId` returns `{incident, occurrences}`. Limit/offset paginate occurrence history in descending creation/ID order. Each occurrence exposes runId, attempt and findingId so clients can fetch the authorized run detail and its evidence. Missing and cross-tenant incidents return the same 404. Inactive shops receive 403. Query-supplied tenant IDs, unknown filters and duplicate keys are rejected; responses use no-store. No public lifecycle-write endpoint exists.

## Verification without Docker

`pnpm check` covers pure recovery/order/configuration rules, reconciliation query predicates, duplicate counts, late failures, reopening, lease rejection and authenticated APIs, then builds both apps and runs production HTTP tests. Chrome fixtures remain browser regressions, not proof of incident database concurrency.

`pnpm test:database` includes real concurrent completions, repeated failures, resolution/reopening, reverse-order observations, configuration isolation, rollback, SQL constraints, inactive access and redaction. It requires a dedicated TEST_DATABASE_URL with all seven migrations applied. The suite creates unique tenants and removes only its fixtures. No test service is automatically provisioned, and no Docker command is required locally.

Live acceptance: on an authorized development storefront, complete two runs with the same technical failure and verify one incident with count two. Complete a clean run under the same configuration and verify resolution; repeat the failure and verify the same incident reopens. Confirm another shop cannot read it. This acceptance remains separate from controlled fixtures and unconfigured database tests.
