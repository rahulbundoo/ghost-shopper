# Deterministic technical analysis

Phase 6 turns observed step results and bounded diagnostic exports into explanations without AI. Each run attempt receives an immutable analysis with findings, severity, a versioned score and fingerprints. Findings describe what was observed, not an inferred root cause or an assessment of the whole store.

## Rules and severity

Rules version `technical-v1` implements the technical subset of AGENT.md's closed taxonomy. Experience findings such as unclear pricing and mobile layout issues are not emitted by these rules.

| Finding types                                                                      | Severity | Evidence                                                                        |
| ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| PAGE_UNAVAILABLE, PRODUCT_NOT_FOUND, VARIANT_UNAVAILABLE, VARIANT_SELECTOR_FAILURE | HIGH     | Failed semantic step                                                            |
| ADD_TO_CART_FAILURE, CART_FAILURE, CHECKOUT_FAILURE                                | CRITICAL | Failed semantic step                                                            |
| HTTP_ERROR                                                                         | MEDIUM   | Observed HTTP response status of 400 or greater                                 |
| JS_ERROR                                                                           | MEDIUM   | Uncaught page exception, not arbitrary console.error text                       |
| BROKEN_IMAGE                                                                       | LOW      | Image request with an HTTP error response                                       |
| SLOW_PAGE                                                                          | LOW      | Successful OPEN_HOME, OPEN_PRODUCT or OPEN_CART action lasting at least 5000 ms |

ACTION_TIMEOUT maps to the failing action's technical type and explicitly mentions the time limit. It does not prove that all customers are blocked. RUN_ABORTED and UNSAFE_NAVIGATION make analysis incomplete without blaming the merchant. Skipped steps generate no findings. Failed requests without an HTTP response remain network evidence only: they can be safety-policy blocks, cancellation or infrastructure failures. Broken-image detection does not inspect decoding, visibility or lazy-loaded images. Slow-page duration is the action's measured elapsed time, not a Web Vital or isolated network timing.

Repeated events of the same type and step are grouped into one finding with an occurrences count. This groups observations within an attempt; it does not create incidents. Exports retain their original privacy controls and bounds. Findings contain fixed, safe explanations rather than arbitrary console text, exception messages or resource URLs.

## Score and completeness

The technical score starts at 100. Deduct once per distinct finding type: INFO 0, LOW 5, MEDIUM 15, HIGH 40, CRITICAL 100. Clamp at zero. Repeated events or the same type at several steps do not multiply the penalty. These are product rules, not an industry benchmark or conversion estimate.

A numeric score requires seven valid ordered step results, both bounded diagnostic exports without dropped/malformed data, and no reported capture/upload failure or browser WARNING. A failed step followed by skipped steps is a valid completed observation of the attempted journey; it does not imply those skipped pages were assessed. Missing results, cancellation, policy rejection or truncated diagnostics produce `complete: false` and `score: null`, never an assumed 100. Historical runs without Phase 6 analysis return an empty analyses list.

FAILED journeys remain FAILED regardless of score. A successful journey with any technical finding becomes WARNING. Incomplete otherwise-successful analysis is also WARNING. No findings plus complete successful observations yields PASSED. Infrastructure errors remain ERROR at run level; any partial analysis is supplemental, not a replacement for that error.

## Fingerprints and persistence

Fingerprint version `finding-v1` hashes a canonical array of tenant, monitor, scenario, finding type, action, device, product and selected variant using SHA-256. Run ID, attempt, timestamps, wording, severity and query strings are excluded. The same issue repeats with the same fingerprint across runs; different tenants and configurations remain distinct. Changing identity inputs or scoring rules requires an explicit version decision. Phase 7 consumes these identities when reconciling [incidents](INCIDENTS.md) atomically with run completion.

The additive `202609300006_deterministic_analysis` migration adds RunAnalysis and Finding. The runner saves findings and their summary atomically under its current unexpired lease, tenant and attempt. Persisted RunStep rows are authoritative. Concurrent duplicate saves serialize on the parent run and return the existing immutable attempt. Compound foreign keys protect run, step and artifact associations from cross-tenant or cross-attempt linkage.

Findings optionally reference a matching READY artifact and step. Missing evidence does not suppress the observed finding; references can be null. Artifact expiry still controls downloads. Referenced artifact metadata cannot be deleted independently without first detaching the reference; bucket object expiration does not delete metadata. Verified shop redaction cascades analysis and findings with the run.

During normal execution, analysis runs after COLLECTING advances to ANALYZING and before COMPLETED. Failure to persist analysis yields terminal ERROR / ANALYSIS_FAILED without automatically replaying cart effects. Timeout/startup failure makes a best-effort partial analysis while the lease permits it. With analysis enabled, evidence cleanup gets at most 20 seconds, reserving time within the existing 30-second lease margin for a transaction with a one-second acquisition wait and five-second execution timeout. Hard crashes, lost leases and database outages may leave no analysis. A crash after saving but before terminal state can leave an immutable analysis for an earlier attempt; the existing recovery policy may claim a new attempt. Exactly-once external storefront effects are not guaranteed.

## API and verification

Authenticated GET `/app/api/runs/:runId` now returns `{run, steps, artifacts, analyses}`. Analyses are ordered by attempt, capped at three, with at most 88 findings each (11 types times eight step scopes including null). Each includes rulesVersion, complete, score, outcome, createdAt and findings. Findings expose source DETECTED, type, severity, explanation, count, fingerprint and optional evidence/step IDs. Active-shop authentication and tenant-scoped repositories apply; there is no public analysis write endpoint. API consumers should select the analysis matching run.attemptCount rather than treating an older attempt as current.

Unit tests cover rules, score boundaries, fingerprint stability, diagnostics, lease fencing, idempotent save and failure handling. Real Chrome fixtures exercise failed-cart evidence through the analysis adapter. Production HTTP tests protect the existing run endpoint. The dedicated PostgreSQL suite covers concurrent saves, constraints, evidence references, tenant isolation, terminal fencing and redaction, and requires a migrated TEST_DATABASE_URL. No Docker or additional service is needed for unit/Chrome checks; real PostgreSQL and live Shopify acceptance remain separate checks.
