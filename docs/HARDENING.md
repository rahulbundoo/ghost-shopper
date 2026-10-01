# Production hardening and external testing

Phase 12 adds application safeguards and operational tooling, not a deployed or certified production environment. Operators must complete the acceptance checklist below before inviting external merchants. Local development and checks require no Docker.

## Deployment configuration

Apply all eleven reviewed migrations, including `202610010011_production_hardening`, before starting web and runner. It adds shared rate-limit buckets, runner heartbeats and durable artifact-deletion intents, backfilling existing artifact keys. Migration and application rollback need a tested backup; never reset a database as an upgrade step.

Build with `pnpm build`. Both the compiled web launcher and runner validate configuration. `pnpm config:check` validates without contacting services. Set `DEPLOYMENT_ENV=staging` or `production` explicitly; `local` is only for local development/CI, including compiled local previews with NODE_ENV=production. Do not use local mode to bypass deployment gates.

Nonlocal environments require:

- A random 32-byte `SESSION_ENCRYPTION_KEY`, encoded as 64 hexadecimal characters, and a separate random `READINESS_TOKEN` of 32–128 URL-safe characters.
- Real Shopify and storage secrets, PostgreSQL TLS (`sslmode=require`, `verify-ca` or preferably `verify-full`), authenticated `rediss:` and HTTPS storage. Certificate/CA and network policy must be verified against the selected providers.
- `BILLING_ENABLED=true` and explicit plan configuration, so authenticated run creation has enforceable budgets. Use test billing for authorized development-store acceptance; do not activate real charges implicitly.
- `ARTIFACT_BUCKET_LIFECYCLE_CONFIRMED=true`, `RUNNER_ISOLATION_CONFIRMED=true`, `BACKUP_RESTORE_VERIFIED=true` and `INGRESS_LIMITS_CONFIRMED=true` only after verifying those protections. These flags are operator attestations, not infrastructure discovery or automatic setup.

Inject secrets through a deployment secret store; never put real credentials in images, Git, logs or shell command arguments. Use separate staging/production identities and least-privilege database, Redis and bucket permissions. Only the runner needs object Put/Delete access; web needs authorized signing access. Losing the session key makes encrypted sessions unusable; protect it separately from database archives and include it in recovery planning.

## Session migration and key rotation

Access and refresh tokens use AES-256-GCM with random nonces and authenticated binding to the session ID and token kind. The official Shopify session adapter still owns its schema and session behavior. Wrong keys, tampered ciphertext, or legacy plaintext under an enabled key fail closed.

For an existing database, stop web/runner writers and take a protected backup. Set the new SESSION_ENCRYPTION_KEY; for rotation also supply PREVIOUS_SESSION_ENCRYPTION_KEY through the secret store. Run `pnpm sessions:rotate-key` to inspect compatibility without writes, then `pnpm sessions:rotate-key --apply` during the maintenance window. The tool processes bounded batches and uses compare-and-set updates; it does not print tokens. Re-run the check without the previous key before restarting both applications with the new key. Partial rotations can be resumed with both keys; do not discard the previous key or backup until recovery is verified. Reauthorization is the alternative to migrating legacy sessions.

## Request and browser limits

Authenticated requests share PostgreSQL fixed-minute budgets across web processes: 120 merchant reads, 20 monitoring writes, 10 billing reads and 5 billing writes per shop. A denied request returns 429, no-store and Retry-After 60. Limits fail closed on database failure. They do not cover unauthenticated traffic or replace run allowances. The ingress must bound connections, request sizes and request duration, and rate-limit authentication/webhook abuse without preventing legitimate signed Shopify retries. Existing application JSON limits remain 16 KiB.

The runner keeps the public-IPv4-pinned, host-allowlisted CONNECT proxy, no-follow redirect checks, blocked private/metadata destinations, blocked service workers/WebSockets and checkout stop policy. Phase 12 adds a per-run 128-socket cap, 512 connection cap, 15-second idle timeout and 64 MiB aggregate upstream encrypted-byte budget. These are not decoded-body, CPU or memory limits: Playwright may buffer decompressed responses before checking size. Deploy the runner in an unprivileged sandboxed runtime with hard process-memory, CPU and temporary-disk quotas, a supervisor timeout and network egress isolation. Never disable the Chromium sandbox to make deployment work. Permit only required service endpoints and public storefront traffic; explicitly deny metadata/internal destinations. The browser sandbox must not have access to host secrets.

## Evidence and retention

Artifacts remain private, tenant-authorized and available only through short-lived signed downloads. `TRACE_ENABLED=false` is now the runner default because native trace operation data can contain sensitive values. Enable traces only after a privacy review; screenshot masks and redacted diagnostics do not guarantee full visual redaction.

Every artifact reservation also records a deletion intent in the same database transaction. Runner maintenance leases at most five due keys per pass, issues bounded storage deletes, fences acknowledgements and retries failures with exponential delay capped at six hours. A failed delete stops that pass. Deletion continues independently of the scheduling/email feature flags. Alert on repeated retention failures and overdue intents; do not claim erasure merely because application access expired.

| Data                                                | Retention behavior                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Evidence objects                                    | Expire after ARTIFACT_RETENTION_DAYS, default 7, allowed 1–30; durable deletion plus mandatory bucket lifecycle |
| Redacted shop evidence                              | Deletion intents survive metadata cascade and become due after a ten-minute in-flight-upload grace period       |
| Signed download links                               | At most 60 seconds; previously issued links are not immediately revocable                                       |
| Terminal email delivery records                     | Maintenance prunes records finished more than 90 days ago, in bounded batches                                   |
| Rate-limit buckets and runner heartbeats            | Stale records are pruned after one day                                                                          |
| Run, finding, incident, usage and artifact metadata | Retained while the tenant exists; signed shop redaction cascades tenant metadata                                |
| Logs, provider records and backups                  | Operator-managed policy and access controls; not erased by the application cascade                              |

S3 DeleteObject without a version ID creates a delete marker in a versioned bucket. Verify lifecycle deletion of noncurrent versions, expired markers and incomplete multipart uploads, including orphan objects. Bucket encryption, no anonymous access and lifecycle timing require actual provider acceptance. Object Lock/legal retention may prevent deletion. Restrict the deletion table as sensitive metadata even though keys use hashed shop identifiers.

Publish a privacy policy consistent with these actual behaviors. Active-tenant history is not automatically aged out; agree a retention period before broader release and use a separately reviewed archival policy if needed. Backups can retain redacted records until archive expiry; after restoring an old backup, reconcile subsequent uninstall/redaction events before reconnecting external traffic. Provider email records, telemetry and optional AI data need separate retention review. Pruning old delivery records can remove the context for very late recovery notifications.

## Monitoring and failure policy

`/health` remains public process liveness. `/ready` requires `Authorization: Bearer <READINESS_TOKEN>` and never accepts query-string credentials. Unauthorized probes return opaque 404; authorized probes return 200 only when PostgreSQL works and a runner has recorded a Redis-responsive heartbeat within three minutes, otherwise 503. Configure probe intervals and alerting externally. This is not proof that S3, Shopify, Chromium, billing or email is healthy, nor a check of every worker replica.

Optional SENTRY_DSN enables a minimal metadata-only Sentry SaaS envelope transport. It sends safe event/service/code labels, not exceptions, stacks, shop/run identifiers, request bodies, URLs or breadcrumbs. Each process permits two in-flight submissions and ten per minute, with a three-second timeout, no redirects and no retries. Invalid DSNs fail compiled startup. Delivery is deliberately lossy and cannot replace structured logs or external uptime checks. Self-hosted Sentry DSNs are not supported by this transport.

Alert externally on readiness failure, stale run/dispatch leases, queue age, billing verification failures, repeated retention/upload/email failures, failed backups and disk/memory exhaustion. Monitor deletion backlog age directly in PostgreSQL. Use metadata-only logs with restricted access and a documented expiry; redact authorization headers at the ingress as well. No alert destination is provisioned automatically.

Existing run retry rules remain: infrastructure dispatch uses durable intents/backoff, duplicate claims are fenced, and terminal browser runs are not replayed automatically. Storage requests have five-second deadlines and at most two SDK attempts. Email has its existing six-attempt/23-hour idempotency window; AI does not retry ambiguous requests. Merchant mutations do not auto-retry on 429 or ambiguous network failures. See [runner operations](RUNNER.md), [automation](AUTOMATION.md) and [AI limits](AI.md).

## Backups and recovery

Install trusted PostgreSQL client tools compatible with the server. `pnpm db:backup --check` validates DATABASE_URL, TLS and absolute BACKUP_FILE without contacting the database. `pnpm db:backup` writes a custom-format pg_dump archive using exclusive creation; it never overwrites an existing file. Connection secrets are passed through the child environment rather than command arguments and raw provider diagnostics are suppressed. A failed archive is retained and must not be treated as a valid backup.

The archive is not encrypted by this script. Write only to an encrypted, access-restricted volume, encrypt before off-host replication, and configure scheduled backups, expiry and failure alerts in your deployment platform. Windows operators must verify directory ACLs; a POSIX creation mode is not a Windows access-control guarantee. Suggested initial pilot targets are a 24-hour recovery point and four-hour recovery time; these are targets, not measured guarantees. Managed point-in-time recovery can improve them.

To rehearse recovery, provision a fresh isolated database named `ghostshopper_restore_<suffix>`, set RESTORE_DATABASE_URL and BACKUP_FILE, then run `pnpm db:restore-check --check`. Actual restore requires `pnpm db:restore-check --confirm-isolated-restore`. The tool does not create databases, drop existing objects or restore into an ordinary production database name. Name validation does not prove network isolation: verify the target account/host yourself. Disable scheduling, mail, AI and live billing in the rehearsal environment.

After restore, verify migration/schema state, row counts, session decryption, tenant isolation, representative application queries and artifact references. Record archive age and elapsed recovery time. Keep restored data private, reconcile redaction events and dispose of the rehearsal through an approved procedure. Redis is not the authoritative run ledger; test database dispatch recovery with a clean dedicated queue. Object storage must have its own availability/recovery policy consistent with evidence expiry.

## Acceptance before external merchants

- Apply all migrations to a dedicated database and pass `pnpm test:database`, `pnpm test:queue` and `pnpm test:storage` using authorized isolated services. Local mocked checks do not prove SQL concurrency or provider compatibility.
- Verify secret migration/rotation, TLS certificate validation, least privilege, bucket anonymity denial and actual current/noncurrent object expiry.
- Rehearse a backup restore and document achieved recovery times. Only then confirm BACKUP_RESTORE_VERIFIED.
- Prove runner sandbox/egress/resource limits and ingress abuse controls. Test a blocked metadata/private destination, oversized resources and graceful forced shutdown without purchases.
- Exercise a runner/Redis outage, confirm `/ready` fails after heartbeat expiry, and verify the alert reaches an operator. Verify a metadata-only Sentry event if configured.
- Run the existing Shopify install/uninstall/reinstall, cross-tenant evidence, failed/recovered journey, billing-test and email-opt-in acceptance checklists on authorized development stores. Verify no order/payment submission occurs.

No live deployment, restore, token rotation, Sentry submission or cloud-policy change is performed by implementing this phase.
