# Operations

Phase 12 requires all eleven migrations and explicit DEPLOYMENT_ENV for compiled production-mode startup (`local` for local previews only). Read [production configuration, secret migration, retention, readiness and backup recovery](HARDENING.md) before deployment. Environment confirmation flags must reflect verified infrastructure; they do not provision protections. No Docker is required locally.

Phase 11 requires all ten migrations. Billing stays disabled until a price and paid run allowance are configured consistently in web and runner. Keep test mode on for acceptance; live mode can create real merchant-approved subscription charges. The runner needs Shopify offline credentials when billing is enabled. Observe billing synchronization failures: paid admission closes after one hour without verification. Disabling billing does not cancel existing Shopify charges. See [activation and acceptance](BILLING.md).

## Local Node development

Install Node 22.15+ within major 22 and pnpm 10.34.6. Run `pnpm install --frozen-lockfile`, then `pnpm dev`. Open http://127.0.0.1:3000. No Docker is started or downloaded by these commands.

The public landing page and liveness endpoint run without external services. Shopify routes require the app credentials, a public HTTPS origin and a native/remote PostgreSQL database. Follow [Shopify setup](SHOPIFY_SETUP.md). Runtime credentials are loaded from the root .env or process environment; CLI-provided values take priority. Shared package changes require restarting the root dev command.

For a production build, run `pnpm build`, then `pnpm start`. Run `pnpm start:runner` separately with PostgreSQL and Redis configuration. The web health endpoint reports process liveness only, not database/Shopify/worker readiness. See [runner operations](RUNNER.md).

## Database

`pnpm db:migrate` applies explicit reviewed migrations to DATABASE_URL. Migrations are never run implicitly by app startup. Use a separate TEST_DATABASE_URL for database tests. Never reset or delete database data automatically.

Phase 2 adds Monitor/TestRun; Phase 3 adds dispatch intent, leases and attempt metadata. Apply all migrations before using the API/runner. To test, migrate a separate disposable database using its URL as DATABASE_URL, then run `pnpm test:database` with TEST_DATABASE_URL set to that same database. Set TEST_REDIS_URL for `pnpm test:queue`. Historical Phase 2 queued records remain inert. Phase 10 scheduling requires explicit deployment activation.

## CI and optional containers

The retained Phase 0 Compose definitions are optional and CI-oriented: PostgreSQL, Redis and private MinIO. They are not required for Phase 1 local development. CI builds both application images and runs PostgreSQL lifecycle tests. The web image preserves pnpm workspace dependencies; image-size optimization remains production hardening.

MinIO's published images were unavailable during Phase 0 verification, so its optional local fixture builds pinned upstream sources. This archived community software is not the production storage recommendation. See [ADR 0005](../adr/0005-s3-artifact-storage.md).

## Deployment still required

Phase 4 adds the RunStep migration and a Chromium runtime requirement. Use existing Chrome locally with BROWSER_CHANNEL=chrome; `pnpm test:browser` exercises controlled fixtures without PostgreSQL/Redis. CI installs only headless Chromium and runs these fixtures; the optional runner image includes that shell and system libraries. Runtime must support Chromium's sandbox. See [browser operations and compatibility limits](BROWSER.md). No Docker commands are required locally.

No staging/production service is deployed. Before merchant testing beyond your development store, configure secret storage, database encryption/backups, monitoring, retention, operational alerts and reviewed migrations. Shopify credentials and database tokens must never appear in logs or client bundles.

Phase 5 adds an additive Artifact migration and requires explicit private S3 settings for runner startup. Web loads storage only for authorized downloads. Use existing native/remote storage without Docker; configure bucket expiration (including versions), encryption, least-privilege identities and denial of anonymous access. Database expiry does not physically delete bytes. Observe artifact.ready/artifact.upload.failed logs, failed/pending rows and WARNING outcomes; never log provider errors or signed links. See [evidence operations and dedicated storage acceptance](EVIDENCE.md).

Phase 6 adds the reviewed RunAnalysis/Finding migration, with no new service or dependency. Apply migrations before starting the new runner/web builds. Inspect run-detail analyses for technical-v1 scores and DETECTED findings; null scores mean incomplete assessment. ANALYSIS_FAILED is terminal and does not automatically replay a cart. Historical runs are not backfilled. Verify constraints/concurrency with `pnpm test:database` on a dedicated migrated database. See [analysis rules and limitations](ANALYSIS.md).

Phase 7 adds the incident migration; apply it before running the new web/runner builds. No extra services, credentials or dependencies are needed. Inspect authenticated incident APIs for OPEN/RESOLVED status and lifetime distinct-run counts. Completion and reconciliation commit together; database contention or reconciliation failure can produce terminal ANALYSIS_FAILED. Old configurations are not automatically marked recovered, and no historical backfill or email alert delivery is implemented. Verify concurrent completion/rollback using the dedicated database suite. See [incident operations](INCIDENTS.md).

Phase 8 adds the AiAnalysis migration; apply all eight migrations before starting these builds. AI stays off unless explicitly enabled with a key, compatible model and current token rates. Invalid AI configuration disables only enrichment. Observe `ai.disabled`, `ai.skipped`, `ai.succeeded`, `ai.failed`, `ai.commit.rejected` and `ai.recovery.failed` events; inspect separate run-detail `aiAnalyses` records. Interrupted requests expire after two minutes and are never automatically retried. The shutdown deadline is 375 seconds to permit a bounded AI tail. No historical backfill, model-quality guarantee, tenant budget enforcement or live provider acceptance is implied. See [AI setup and acceptance](AI.md).

Phase 10 requires all nine migrations. Set SCHEDULER_ENABLED=true to activate eligible monitors; EMAIL_ENABLED=true additionally requires the Resend sender/key, app origin and merchant opt-in. Keep flags/configuration consistent across web and runner. Defaults remain off. Uninstall disables both monitors and channels. Review persisted email status and metadata-only logs; never replay FAILED records beyond the provider idempotency window. Read [automation setup, retry policy and acceptance](AUTOMATION.md) before enabling. No Docker or live mail is needed for local unit/browser checks.
