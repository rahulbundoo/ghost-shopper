# 0011: Private evidence lifecycle

- Status: Accepted
- Date: 2026-09-30
- Extends: 0005 S3 artifact storage and 0010 Browser journey engine

## Decision

Runner composes browser evidence capture with application storage/repository ports. S3 holds bytes; PostgreSQL holds tenant-bound metadata. Reserve PENDING under the execution lease, upload a generated private object, then acknowledge READY under the same lease. Never advertise ambiguous uploads as ready. The authenticated web API signs at most 60-second attachment downloads only for active owners of unexpired READY artifacts.

Use per-action masked screenshots, an operation-only trace and bounded diagnostic JSON. Omit arbitrary console/exception text; treat native traces as sensitive. Capture failures downgrade otherwise passing runs to WARNING. Cleanup on timeout has a bounded lease-preserving grace period.

## Consequences

No distributed S3/PostgreSQL transaction is assumed. Pending rows and orphan objects are possible; bucket lifecycle expiration is mandatory. Database expiry controls access, not physical deletion. Uninstall blocks new links but cannot revoke an issued link immediately. No new deployable service or dependency enters domain/application; web never imports Playwright.

Local development uses an existing native/remote private bucket without Docker or automatic provisioning. This operational option supplements ADR 0005's optional MinIO environment; the S3 boundary is unchanged.

## Verification

Real Chrome fixtures, upload/authorization unit tests and controlled SDK HTTP tests run without external services. Dedicated PostgreSQL and private S3 suites cover persistence and actual object access when configured. Live Shopify and deployed retention/security acceptance remain separate. See [evidence operations](../docs/EVIDENCE.md).
