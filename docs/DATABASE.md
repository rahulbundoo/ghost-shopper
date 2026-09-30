# Database

Phase 1 uses PostgreSQL and Prisma 6.19.3, matching the official Shopify session adapter's supported peer range. The reviewed initial migration is in `packages/database/prisma/migrations`.

Shop's primary key is the canonical myshopify.com domain; custom storefront domains are metadata, never tenant selectors. Shop also stores the Shopify GID, display name, currency, scopes and installation/synchronization timestamps.

Session follows Shopify's official adapter field contract, including expiring offline tokens and refresh tokens. Its SDK property `shop` maps to the persisted `shopId` column, with a foreign key to Shop and cascading deletion. Only offline sessions are requested, avoiding merchant user profile storage.

ShopRepository accepts authenticated domains and scopes all lifecycle mutations. Profile synchronization rejects a different shop identity. Uninstall deletes only that tenant's sessions. Shop redaction deletes an uninstalled tenant; an active reinstall is retained.

Run `pnpm db:migrate` with an explicit DATABASE_URL from the root .env. No fallback database, schema push, reset or automatic destructive startup migration exists. For tests, migrate a separate disposable database and set TEST_DATABASE_URL before `pnpm test:database`.

Tokens are server-side secrets; database access and backups must be restricted and encrypted at rest by the deployment environment. Application-level token encryption, backup/restore and retention operations remain production-hardening work.

## Phase 2 monitoring persistence

The additive `202609290002_monitoring_core` migration creates Monitor and TestRun, leaving existing Shop and Session records unchanged. UUIDs are generated server-side by Prisma. Every monitor/run has a mandatory shopId, indexed for tenant-scoped chronological lists.

Monitor stores name, product/optional variant GIDs, PURCHASE_JOURNEY scenario, DESKTOP/MOBILE device, a predefined frequency, enabled flag and optimistic version. Edits require the current version and increment it atomically. Changing the product clears a stale variant unless a replacement is supplied.

TestRun stores a snapshot of product, variant, scenario, device and monitor version. Its compound `(shopId, monitorId)` foreign key references Monitor's `(shopId, id)`, so PostgreSQL itself rejects cross-shop relationships. Creation always starts at QUEUED with no outcome/timestamps. SQL CHECK constraints protect product identifiers, versions, lifecycle/outcome consistency and timestamp ordering; these checks are maintained explicitly in migration SQL because Prisma does not represent them in its schema.

`createTenantRepositories` is a server-only factory accepting the authenticated session's shop domain. All operations validate inputs, check installation status and apply shopId filters. Serializable transactions with bounded conflict retries protect reads/checks/writes; optimistic version predicates reject stale monitor edits. Missing and cross-tenant entity lookups are indistinguishable. Shop reads select only safe domain fields, not session tokens or scope metadata.

Uninstall retains monitoring history but blocks access through these repositories. Verified shop redaction cascades to the tenant's monitors/runs. Monitor deletion is not exposed; disable monitors to preserve history. Future artifact retention must account for this lifecycle.

PostgreSQL constraints enforce referential integrity, not row-level authorization: tenant filtering is enforced by these server repositories. Do not expose raw Prisma clients to request handlers or untrusted callers.

Billing tables remain deferred. Finding, incident and AI persistence are described below.

## Phase 3 dispatch and ownership

Migration `202609290003_run_dispatch` adds dispatchRequested, nextDispatchAt, attemptCount, leaseToken, leaseExpiresAt and errorCode to TestRun. New repository-created runs set dispatchRequested in the same insert; older runs retain false. A bounded pending-work index supports reconciliation without a separate service or outbox table.

PrismaRunStore is an internal cross-tenant dispatcher/worker adapter, not a merchant API repository. Job-specific claims and writes always include shopId/runId; claim transactions verify active shop and enabled monitor. Only an unexpired lease token can advance/fail the current run, with at most three persisted attempts. Public repository selects exclude dispatch and ownership metadata. Uninstall cancels nonterminal runs and revokes ownership; redaction cascades remain tenant-scoped.

The worker handles PostgreSQL serialization/dependency failures through queue retries/reconciliation. No Redis transaction can atomically commit a PostgreSQL write; durable intent and idempotent claims close that delivery gap. See [ADR 0009](../adr/0009-durable-run-dispatch.md).

## Phase 4 step persistence

Migration `202609290004_run_steps` adds RunStep with closed action/status/error enums and a compound `(shopId, runId)` foreign key. `(shopId, runId, attempt, position)` is unique; timing/attempt/position/outcome checks guard storage. Recording locks the parent with a conditional update requiring current unexpired lease, RUNNING status and matching attempt, then inserts idempotently in the same transaction. Old attempts cannot overwrite new step results. Read APIs enforce active tenant scope and return at most 21 steps. Redaction cascades through the parent run. No existing run rows are rewritten by this migration.

## Phase 5 artifact persistence

Additive migration `202609300005_artifacts` creates Artifact metadata and upload-state/type enums, with tenant/run and tenant/run/attempt/step compound foreign keys. Size, attempt, position, hash, expiry and error-state checks protect rows. The parent run's current unexpired lease fences both reservation and finalization; a transaction locks the run before enforcing at most 11 artifacts per attempt. Upload acknowledgements move PENDING to READY or FAILED only once.

Public lists omit storage keys. Downloads select only an active tenant's READY, unexpired artifact. Shop redaction cascades metadata, not S3 bytes; uninstall revokes leases and blocks new downloads. Bucket lifecycle rules must handle expiration and orphan objects. See [evidence retention](EVIDENCE.md). The dedicated PostgreSQL artifact suite exercises actual constraints and must be run after migrating TEST_DATABASE_URL.

## Phase 6 analysis persistence

Migration `202609300006_deterministic_analysis` adds RunAnalysis and Finding with closed technical type, severity, source and outcome enums. Summaries are unique per tenant/run/attempt; fingerprints are unique within an attempt. SQL checks enforce score/completeness consistency, attempt/position/count bounds and fingerprint shape. Compound foreign keys enforce tenant/run/attempt association for analysis, steps and optional evidence. Saves lock the current unexpired RUNNING/ANALYZING lease, use persisted steps and atomically write immutable summaries/findings; duplicate saves return the existing analysis. Reads check active tenant scope. Redaction cascades metadata; independently deleting referenced artifact metadata requires detaching findings first. See [analysis behavior](ANALYSIS.md). Apply the migration to a dedicated TEST_DATABASE_URL before running the new persistence suite.

## Phase 7 incident persistence

Migration `202609300007_incidents` adds IncidentScope, Incident and IncidentOccurrence, their tenant-scoped foreign keys, uniqueness and state checks. Scope stores a clean-observation watermark for a configuration/rules version. Incident identity is unique by tenant/monitor/configuration/fingerprint. Occurrences are unique by tenant/incident/run and tenant/finding, counting one completed run only once. PrismaRunStore uses a parameterized monitor row lock before the lease-fenced completion update, then reconciles incidents in the same transaction. Any error rolls back both. No network I/O occurs inside the transaction. Uninstall blocks access without claiming recovery; redaction cascades all incident records. Referenced-run retention needs a separate policy. See [incident semantics](INCIDENTS.md).

## Phase 8 AI persistence

Migration `202609300008_ai_analysis` adds AiAnalysis with a tenant/run compound foreign key, unique tenant/run/attempt reservation, status/expiry index and SQL checks for state/result consistency and nonnegative cost/latency. A reservation requires a completed current-attempt run, active installation and READY unexpired screenshot metadata. Provider calls happen outside all database transactions and after deterministic completion. Finalization requires matching tenant/run/attempt, RUNNING status and unexpired deadline; it cannot overwrite a terminal AI result. Interrupted requests expire without replay.

Only validated result/usage JSON and decimal USD estimates are stored, with input hash, evidence steps and version/model/pricing metadata. No screenshots, raw prompts or raw provider responses enter PostgreSQL. Active-tenant reads expose separate AI_ANALYSIS records; redaction cascades them. No existing run is backfilled. See [AI behavior](AI.md).
