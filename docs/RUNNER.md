# Queue and runner

## Run without Docker

Use Node 22 and the workspace pnpm version. Provide a native or remote PostgreSQL database and Redis (6.2+ with persistence and `maxmemory-policy=noeviction`). Set BROWSER_CHANNEL=chrome to use your existing Chrome without a download. Phase 5 also requires an existing private S3-compatible bucket; see [evidence configuration](EVIDENCE.md). Use separate Redis namespaces/databases for development, tests and production; do not use an eviction-enabled cache as the queue.

Set root `.env` values: DATABASE_URL, REDIS_URL (`redis://` or TLS `rediss://`), QUEUE_PREFIX (default ghostshopper), RUNNER_CONCURRENCY (1–10, default 2), RUN_TIMEOUT_MS (1000–300000, default 120000), ACTION_TIMEOUT_MS (1000–30000, default 10000), and BROWSER_CHANNEL (chromium, chrome or msedge). Never put real connection strings in source control or logs. Shopify credentials are needed by web, not by the runner.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev:runner
```

In another terminal run `pnpm dev:shopify` for authenticated API access. Production uses `pnpm build` then separate `pnpm start` and `pnpm start:runner` processes. `node apps/runner/dist/index.js --check` verifies module loading only, not database/Redis readiness. Startup without required settings fails safely with a structured error.

## Dispatch and processing

1. An authenticated POST `/app/api/runs` saves the TestRun and dispatch intent in one PostgreSQL insert.
2. Web makes a bounded best-effort BullMQ publish, using the run UUID as job ID. Response is 202 with `dispatch: ENQUEUED` or `DISPATCH_PENDING`.
3. Runner scans durable pending work every five seconds, publishing missed jobs. A successful publish postpones reconciliation for 60 seconds. No public request waits for browser work.
4. The worker validates versioned RUN_MONITOR payloads containing only shopId/runId. A serializable transaction checks tenant, installation, monitor status, terminal state and lease, then claims an attempt.
5. Only the current, unexpired lease token can advance/fail that run. Duplicate terminal jobs are ignored. Expired attempts can be reclaimed; persisted attemptCount caps execution at three attempts even if Redis jobs are recreated.

Queued runs predating Phase 3 have dispatchRequested=false and remain inert. The migration does not silently start historical work. Monitor disable prevents new claims; uninstall cancels queued/active runs and revokes their leases. Disabling a monitor does not interrupt an already-running attempt.

BullMQ retries use three attempts with exponential backoff starting at one second. Redis transport failures can be retried later by reconciliation without consuming an execution attempt. Completed/failed queue jobs are retained with age/count bounds; PostgreSQL remains authoritative after queue retention or Redis recovery. BullMQ completed means delivery was handled, not necessarily that the TestRun passed.

## Phase 4 execution

The shipped executor runs the seven Playwright journey actions and records each result under its current lease. It returns PASSED only on verified checkout initiation with complete evidence, WARNING for otherwise successful journeys with incomplete evidence, or FAILED with structured step errors. Browser infrastructure failures are terminal ERROR and do not automatically replay cart effects. The old unavailable-engine executor remains only as a queue-test fixture. Phase 5 captures/uploads evidence while the RUNNING lease is valid. Phase 6 persists deterministic analysis during ANALYZING before final completion; findings can downgrade PASSED to WARNING, never upgrade a failed journey. Analysis persistence failure becomes terminal ANALYSIS_FAILED without automatic cart replay. See [analysis](ANALYSIS.md), [browser behavior](BROWSER.md) and [evidence lifecycle](EVIDENCE.md).

The processor supports abort signals and bounded execution time. Timeout becomes terminal JOB_TIMEOUT rather than automatically replaying unknown external effects. Lease duration is timeout plus 30 seconds. The browser executor closes contexts/processes on abort and stops when step persistence rejects ownership. Lease fencing prevents stale database writes; it is not an exactly-once guarantee for external side effects under a paused/crashed process.

Phase 5 gives timeout evidence cleanup up to 25 seconds before releasing ownership. Uploads are individually bounded and fenced; no late worker can mark artifacts READY after losing its lease. Storage configuration is mandatory for runner startup. Capture or storage failures remain visible as failed/pending metadata and manifest errors when persistence is available.

Phase 7 completes the run and reconciles incidents in one PostgreSQL transaction under a monitor row lock and the current lease. Duplicate terminal deliveries do not increment counts. Reconciliation failure rolls back completion; existing finalization handling records terminal ANALYSIS_FAILED without automatic cart replay. Complete clean observations resolve only older incidents in the same configuration; incomplete results never prove recovery. See [incident ordering and operations](INCIDENTS.md).

## Operations

Phase 8 optionally runs AI after committed completion, outside the deterministic error path. Configuration defaults off; no provider key is needed for technical monitoring. The runner sends only a bounded subset of existing masked evidence, reserves one request per tenant/run/attempt and never retries ambiguous provider calls. Reconciliation expires interrupted reservations after two minutes without replay. One worker slot remains occupied during the AI tail, while the merchant can already read the completed technical result. See [AI configuration and limitations](AI.md).

Structured JSON logs include service, timestamp, event, runId, shopId, monitorId, jobId, attempt, durationMs and safe error code as applicable. Raw request payloads, exception messages and connection strings are never intentionally logged or placed in BullMQ failure messages. External telemetry/metrics exporters remain production-hardening work.

SIGINT/SIGTERM stop the dispatch loop, drain worker jobs and close connections. An upper shutdown deadline terminates an unresponsive process; the next runner recovers expired leases. Restart is safe but not an excuse to run multiple environments against the same Redis prefix/database.

Do not automatically retry POST run creation: each accepted request intentionally creates a new run. Delivery idempotency is per run ID; API request-key deduplication is not implemented. Monitor frequency remains configuration only; recurring scheduling is Phase 10.

## Verification

`pnpm check` needs no external services. For real lifecycle/queue checks, migrate a dedicated test PostgreSQL database, set TEST_DATABASE_URL and TEST_REDIS_URL, then run `pnpm test:database` and `pnpm test:queue`. Queue tests use a random namespace and delete only their generated queue/tenant fixtures. CI supplies disposable services. These suites must not point at merchant production databases.

Live acceptance: create a monitor for an authorized development storefront and run through the authenticated API; observe 202, runner claim/step logs, and ordered steps through checkout initiation. Stop Redis during submission and verify DISPATCH_PENDING recovers after Redis returns. Deliver the same run again and verify attemptCount does not increase after terminal completion. Native/remote services must be provided to perform these checks locally. `pnpm test:browser` runs controlled Chrome fixtures without these services.
