# 0012 Deterministic technical analysis

- Status: Accepted
- Date: 2026-09-30
- Extends: ADR 0006 and ADR 0011

## Decision

Keep versioned finding, severity, score and identity rules pure in domain. Runner consumes bounded console/network exports before upload and invokes the analysis persistence port after browser work. Database saves a run-attempt summary and findings atomically under the existing execution lease. Tenant-bound read repositories expose results through run details. No AI, incident service or additional dependency is introduced.

## Consequences

Missing observations result in a null score, not a false pass. Explicit semantic failures and actual HTTP responses/page exceptions are classified; blocked requests and aborted actions do not establish merchant defects. Fingerprints are stable configuration identities, not hashes of generated prose. Findings may survive evidence expiration and can have missing artifact references. Storage failure after browser execution does not automatically replay a cart operation.

## Verification

Pure rule and runner tests, authorized API tests and controlled Chrome fixtures cover local behavior without Docker. Real constraint/concurrency/redaction tests require dedicated PostgreSQL. Rule thresholds, limitations and acceptance scope are documented in [technical analysis](../docs/ANALYSIS.md).
