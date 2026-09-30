# Testing

`pnpm check` validates typed linting, formatting, strict TypeScript, unit tests and compiled integration tests. It runs without Docker, PostgreSQL or Shopify credentials.

Unit tests exercise import boundaries, environment validation, canonical tenant domains, GraphQL validation/cross-tenant rejection, and the official SDK's webhook HMAC verification. HTTP integration tests start the production Node server on an ephemeral loopback port with synthetic test configuration, verify the public shell, reject invalid authentication/webhooks, check error pages and prevent secret disclosure.

`pnpm test:database` requires TEST_DATABASE_URL pointing to a dedicated migrated PostgreSQL database. It tests offline/refresh-token persistence, cross-tenant session rejection, idempotent uninstall and isolation, and redaction/reinstall behavior. It fails explicitly if the database URL is absent and cleans only its generated tenant records. These tests are wired into CI's disposable PostgreSQL instance.

The separate Phase 0 `test:infra` suite checks optional Docker PostgreSQL/Redis/MinIO services. It is not part of local Phase 1 development. Docker image validation remains CI-only; no Docker commands are needed on the laptop.

[Shopify setup](SHOPIFY_SETUP.md) contains the real development-store acceptance checklist. Synthetic HTTP and SDK tests do not prove installation inside Shopify Admin. Browser checks should use Chrome DevTools MCP against the Node server.

Phase 4 adds browser journey fixtures. Never complete real purchases in tests.

## Phase 8 checks

Unit tests cover closed schemas, score/confidence/size bounds, rule-owned severity, screenshot references, minimal inputs, opt-in configuration, token-cost calculation, refusals/incomplete/malformed output, aborts, duplicate suppression, failure isolation, persistence predicates and tenant-authorized reads. A controlled HTTP server exercises actual fetch request/response bytes and redirect rejection with fixture credentials; no paid API is called. `pnpm check` still runs without Docker or external services.

The dedicated PostgreSQL suite adds concurrent one-shot reservations, completion immutability, cross-tenant reads/writes, SQL cost/state checks, expired requests, uninstall and redaction. Apply all eight migrations first. Without TEST_DATABASE_URL these cases remain unverified locally. Provider compatibility, experience quality and actual billing require separately authorized live acceptance; see [AI acceptance](AI.md).

## Phase 7 checks

Unit tests exercise complete-clean recovery, configuration identity, stable request ordering, late failures, reopening, duplicate counts, transaction/lease predicates and authenticated incident list/detail APIs. Production HTTP tests also reject unauthenticated incident requests. `pnpm check` remains independent of PostgreSQL, Redis and Docker.

`pnpm test:database` adds real concurrent completions, distinct-run counts, recovery/recurrence, reverse-order completion, partial/configuration isolation, transaction rollback, tenant constraints, uninstall and redaction. It requires a dedicated TEST_DATABASE_URL with all seven migrations applied and removes only generated tenants. These database scenarios are not established by mocked query tests; without configured PostgreSQL they remain unverified locally. See [live incident acceptance](INCIDENTS.md).

## Phase 6 checks

Unit tests cover semantic failure classification, severity, score bounds, incomplete-data handling, diagnostic filtering/grouping, stable configuration fingerprints, authenticated analysis reads, lease predicates, idempotent writes and analysis failure without cart replay. The Chrome failed-cart fixture feeds real captured JSON through the same diagnostic adapter and pure rule engine. `pnpm check` also builds both apps and runs protected-route HTTP tests.

`pnpm test:database` adds concurrent analysis saves, evidence linkage, SQL checks, cross-tenant rejection, terminal lease fencing and redaction cascades. It requires a dedicated PostgreSQL database with all six migrations applied; it remains unverified locally without TEST_DATABASE_URL. No database substitute or Docker invocation is used. Live Shopify acceptance must verify findings against actual authorized storefront behavior; controlled fixtures are not that acceptance.

## Phase 5 checks

Chrome fixtures check PNG signatures and per-step association, trace ZIP output, sanitized console/network exports, failed cart evidence, timeout flush and storage-failure WARNING outcomes. Unit tests cover upload ordering, lease fencing, configuration, authorization-before-signing and bounded timeout cleanup. SDK integration tests use a controlled HTTP server to inspect signed upload requests and download URL options; they do not claim live S3 compatibility.

`pnpm test:database` adds real artifact persistence, compound foreign-key isolation, stale lease, expiry, failure and uninstall cases. `pnpm test:storage` requires a dedicated private bucket configured through TEST_S3_ENDPOINT, TEST_S3_REGION, TEST_S3_BUCKET, TEST_S3_ACCESS_KEY_ID and TEST_S3_SECRET_ACCESS_KEY. It writes one random fixture, verifies anonymous denial plus signed retrieval, then deletes only that object. CI supplies disposable services. Missing local credentials leave these suites unverified; do not point them at production or provision services implicitly. See [live evidence acceptance](EVIDENCE.md).

## Phase 4 checks

`pnpm test:browser` runs actual Chrome/Chromium against controlled upstream responses. It covers dropdown/radio variants, desktop/mobile contexts, empty initial storage, seven ordered actions, single cart write, sold-out/missing products, wrong carts, HTTP failures, blocked navigation, timeouts and ownership rejection. The same production routing and redirect logic runs in fixtures; checkout content is replaced before scripts execute. Local verification uses installed Chrome with BROWSER_CHANNEL=chrome; no browser download or Docker is needed. CI installs the headless Chromium shell.

Unit tests cover private/reserved address rejection, proxy host/DNS rejection, safe URL redaction, step contracts and tenant-scoped step queries. PostgreSQL tests add step idempotency, foreign-key tenant isolation and stale/terminal lease rejection, but require configured test services to execute. Fixture results do not prove real Shopify compatibility; follow [the acceptance checklist](BROWSER.md).

## Phase 3 checks

Unit suites cover run transition/outcome validation, durable dispatch ordering/failure, processor retries/timeouts/ownership loss, invalid payloads, structured-log allowlists and Redis configuration. Production build tests load the runner with `--check` without claiming service readiness. PostgreSQL tests cover atomic claims, expired lease recovery, fencing, attempt limits, hidden ownership metadata and uninstall cancellation.

`pnpm test:queue` requires both TEST_DATABASE_URL (all migrations applied) and TEST_REDIS_URL. It uses actual BullMQ workers with PostgreSQL to exercise duplicate delivery, retry/backoff and durable dispatch recovery. Synthetic executors exist only in tests; the production runner has no fake success path. Tests use a random Redis prefix and generated tenant, deleting only those fixtures. CI runs this suite with disposable services. Without configured services, database and queue tests remain unverified locally.

## Phase 2 checks

Unit suites cover pure domain rules, strict input validation, service ports, tenant predicates on Prisma calls, snapshot behavior, version conflicts, API authentication/error mapping, JSON body limits and pagination. Production HTTP tests assert that each new endpoint independently rejects unauthenticated requests and forged bearer tokens.

The PostgreSQL monitoring suite creates unique test tenants and checks durable Shop/Monitor/TestRun retrieval, cross-tenant reads/writes, database-level compound foreign-key enforcement, immutable snapshots, disabled monitors, concurrent edits, SQL state checks, deterministic pagination and redaction cascades. It is automatically included in `pnpm test:database` and CI. Apply all migrations to the dedicated test database first. Tests never clear shared tables; cleanup removes only their generated tenants.

Without TEST_DATABASE_URL, the PostgreSQL suite remains unverified locally; successful mocked query tests do not prove SQL behavior. No Docker or embedded database substitute is required or used for local checks.

## Local Phase 1 verification

The Node build, lint, formatting, type checks, unit/HTTP suites and dependency audit were run without Docker. Chrome DevTools verified the setup-pending public page at 1440px desktop and 390px mobile widths with no console errors or horizontal overflow. PostgreSQL lifecycle tests and the real embedded installation checklist remain unverified locally until development credentials and databases are provided.
