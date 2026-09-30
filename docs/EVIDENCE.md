# Evidence (Phase 5)

Runner collects evidence for successful and failed journeys. Web never launches a browser. Each attempt produces up to seven viewport PNG screenshots (one per non-skipped action), an operation-only Playwright trace ZIP, console.json, network.json and metadata.json. The manifest records step results, capture failures and truncation counts. Interrupted actions attempt a screenshot before the context closes; launch failures still attempt diagnostic JSON exports.

## Setup without Docker

Use an existing private S3-compatible bucket, either a maintained remote service or a native local service. No bucket is created by the app. Fill S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_FORCE_PATH_STYLE in root `.env`. Remote endpoints must use HTTPS; loopback HTTP is development-only. Path-style defaults to true; change it to false if required by your provider. Runner requires storage configuration at startup; the public web shell does not.

Apply the additive migration with `pnpm db:migrate` against your configured database. Use existing Chrome with BROWSER_CHANNEL=chrome, then start `pnpm dev:runner`. PostgreSQL and Redis remain required for real runs. No Docker command or browser download is needed locally.

Keep the bucket private: deny anonymous reads/listing and public ACLs, enable encryption at rest, and use separate least-privilege credentials for each environment. Runner needs PutObject under `evidence/`; web's signing identity needs GetObject there. Neither application needs bucket creation or public ACL permissions. Never share production credentials with tests.

## Persistence and access

Evidence keys are generated server-side using a SHA-256 tenant prefix, run UUID, attempt and artifact UUID. PostgreSQL stores tenant/run/step association, original step position, MIME type, byte size, SHA-256, creation/expiry and PENDING/READY/FAILED state. An interrupted screenshot can precede its RunStep row: stepPosition preserves its association even when stepId is null.

The current unexpired RUNNING lease reserves PENDING metadata before upload. Only an acknowledged upload followed by a fenced database update becomes READY. Upload failures become FAILED with a closed error code; ambiguous acknowledgements or process death may leave PENDING metadata or private orphan objects. These are never offered for download. Each attempt permits at most 11 reservations, with at most three attempts per run.

GET `/app/api/runs/:runId` returns `{run, steps, artifacts}`. Lists omit storage keys and signed URLs. GET `/app/api/artifacts/:artifactId/download` independently authenticates the Shopify session, checks active tenant ownership, READY status and expiry, then returns `{url, expiresAt}`. Links expire within 60 seconds, download as attachments and use private/no-store responses. Cross-tenant, missing, expired and non-ready artifacts return the same 404. Do not log or share these bearer links; an already-issued link can remain valid for its remaining lifetime after uninstall.

## Privacy and limits

- Screenshots mask inputs, textareas, editable content and iframes. Other visible storefront content can still contain sensitive information; masks are not a complete redaction guarantee.
- Console exports keep event type, sanitized source URL, line, timing and step position. Arbitrary messages, arguments, exception messages and stacks are deliberately omitted because they may contain secrets.
- Network exports record failed requests and HTTP statuses of 400 or greater, method, resource type, sanitized URL and timing. No headers, cookies, bodies or raw transport errors are exported. Requests blocked by our safety policy also appear as failures.
- Trace recording disables DOM snapshots, screencast screenshots and source files. Native operation parameters may still contain sensitive URLs or other values: traces are **not guaranteed redacted**. Keep them private and view locally; do not upload to third-party viewers or AI services without review.
- Console and network exports each retain at most 200 events, with explicit dropped counts. Each artifact is capped at 20 MiB, aggregate emitted bytes at 32 MiB per attempt; screenshots/traces reserve 1 MiB for JSON diagnostics. Screenshots have a two-second capture timeout. Uploads have a five-second deadline and at most two SDK attempts within it.
- Limits are checked after screenshot generation and trace finalization; they are not hard bounds on Chromium memory or temporary trace-disk growth. Production runner disk/process quotas remain necessary. Unique trace directories are removed during normal cleanup; a hard process kill can leave temporary files requiring operator cleanup.

Evidence failure never turns a failed journey into a pass. An otherwise successful journey becomes WARNING when capture/upload fails; failed journeys remain FAILED. Run timeout allows up to 25 seconds for evidence cleanup before releasing the lease. Hard crashes, lost leases and database/storage outages can leave incomplete evidence. No system can guarantee a complete trace in those conditions; pending/failed metadata and manifest captureErrors make partial collection visible where persistence is available.

## Retention and acceptance

ARTIFACT_RETENTION_DAYS defaults to 7 (allowed 1–30). Expiry blocks new application download links; it does **not** delete objects. Configure and verify bucket lifecycle deletion for `evidence/`, including noncurrent versions if versioning is enabled, consistent with the chosen retention policy. This also cleans private orphan objects. Retention configuration changes do not rewrite existing metadata. No background object/metadata sweeper is implemented in Phase 5.

Uninstall immediately blocks new API access and revokes run leases. Verified shop redaction cascades database metadata, but object bytes remain until bucket lifecycle expiration; immediate verified object erasure requires an operator procedure before production compliance sign-off. Keep backups and object retention aligned with your privacy policy.

`pnpm test:browser` checks real Chrome capture against controlled storefront responses. `pnpm check` tests authorization, upload coordination and signed SDK requests against a controlled HTTP server. `pnpm test:database` requires migrated TEST_DATABASE_URL and exercises real artifact constraints/tenant isolation. `pnpm test:storage` requires dedicated TEST_S3_* settings, uploads one generated fixture, verifies anonymous denial and signed retrieval, and deletes only that object. CI supplies disposable services; local checks never provision them.

For live acceptance, trigger successful and failing desktop/mobile runs on an authorized Shopify development storefront. Verify screenshots match failed steps, trace ZIPs open locally, diagnostic JSON explains the failure, SHA-256/size match downloaded bytes, and another shop cannot access them. Test storage outage and expiry, inspect bucket public-access restrictions/lifecycle, and verify no orders were created. Controlled tests alone do not prove this live acceptance.
