# Monitoring API

These server-only JSON endpoints sit beside the Shopify embedded shell. Every request requires a valid Shopify App Bridge bearer session token (`Authorization: Bearer ...`). A shop query parameter or cookie alone does not authenticate a request. The tenant is always taken from the verified session, never the URL/body. Do not paste tokens into logs or documentation.

| Method      | Path                                      | Operation                                                  |
| ----------- | ----------------------------------------- | ---------------------------------------------------------- |
| GET         | `/app/api/shop`                           | Read the authenticated active shop's safe profile          |
| GET / POST  | `/app/api/monitors`                       | List / create monitors                                     |
| GET / PATCH | `/app/api/monitors/:monitorId`            | Read / edit or disable a monitor                           |
| GET / POST  | `/app/api/runs`                           | List / create a persisted run record                       |
| GET         | `/app/api/runs/:runId`                    | Read a run and its configuration snapshot                  |
| GET         | `/app/api/incidents`                      | List tenant incidents with optional monitor/status filters |
| GET         | `/app/api/incidents/:incidentId`          | Read an incident and paginated occurrence history          |
| GET         | `/app/api/artifacts/:artifactId/download` | Authorize a short-lived private artifact download          |

Writes require `Content-Type: application/json` and a body no larger than 16 KiB. Read/list results use `{shop}`, `{monitor}`, `{monitors}`, `{run}` or `{runs}` envelopes. Monitor creation returns 201; asynchronous run requests return 202. Responses are not cacheable.

## Monitor input

```json
{
  "name": "Main product on mobile",
  "productId": "gid://shopify/Product/123",
  "variantId": null,
  "device": "MOBILE",
  "scenario": "PURCHASE_JOURNEY",
  "frequency": "DAILY",
  "enabled": true
}
```

Name, productId and device are required. The other fields default as shown. Devices are DESKTOP/MOBILE; frequencies are HOURLY/EVERY_SIX_HOURS/DAILY. Names are trimmed and limited to 120 characters. Product and variant references must be correctly typed Shopify GIDs. Catalog ownership/variant membership checks and product-picker UI are deferred; these references are not fetched or executed in Phase 2.

PATCH requires `version` from the current record plus at least one changed monitor field, for example `{"version":1,"enabled":false}`. A successful edit increments version. A stale version returns 409. Changing productId clears the old variant unless a replacement is provided. Tenant IDs, IDs, timestamps and unknown fields are rejected.

## Runs and lists

POST `/app/api/runs` accepts only `{"monitorId":"<UUID>"}`. The monitor must belong to the authenticated active shop and be enabled. The server snapshots its configuration/version and creates a QUEUED record with durable dispatch intent. Phase 3 returns 202 with `dispatch: ENQUEUED` or `DISPATCH_PENDING`; the independent runner reconciles pending work. Reads include attemptCount and safe errorCode, never internal lease tokens. There is no public state-transition endpoint. Each POST creates a new record; do not automatically retry it. Delivery idempotency is per run ID, not per HTTP request.

Phase 8 GET `/app/api/runs/:runId` returns `{run, steps, artifacts, analyses, aiAnalyses}`. Steps are ordered by attempt then position (at most 21: seven per attempt). Each includes action, status, timestamps, durationMs, sanitized currentUrl, errorCode/errorMessage, runId/shopId and attempt. URLs never include query strings or checkout tokens. Run lists do not load steps, artifacts or analyses. Only authenticated tenant-scoped reads are exposed; no public result write endpoint exists. Journeys finish COMPLETED / PASSED, WARNING (technical findings or incomplete evidence) or FAILED; infrastructure failures remain ERROR. See [runner setup](RUNNER.md).

`aiAnalyses` is separate from technical `analyses`, ordered by attempt with at most three records. Each has source AI_ANALYSIS, status RUNNING/SUCCEEDED/FAILED, provider/model/promptVersion, requestedAt/responseAt/latencyMs, inputHash, evidenceSteps, nullable usage/estimatedCostUsd/result/errorCode and tenant/run/attempt identity. Cost is a decimal USD string or null when unknown. Results contain experience, experienceScore and bounded experience findings, never technical health facts. A completed run can still have RUNNING AI enrichment. An empty array means no reservation, not a GOOD assessment. Display model text as untrusted plain text. No prompt, screenshot bytes, provider key or raw provider response is returned. See [AI contract and limitations](AI.md).

Analyses are ordered by attempt (at most three), with rulesVersion, nullable score, complete, outcome, createdAt and findings (at most 88 each). Each finding includes source DETECTED, type/severity, fixed title/description, occurrences, stepPosition, fingerprint and optional stepId/evidenceArtifactId. Missing or expired artifact bytes do not erase findings. Historical runs without analysis return `analyses: []`; incomplete analysis uses `score: null`, not zero or 100. Select the analysis matching run.attemptCount for the latest attempt. See [technical rules, scoring and fingerprint policy](ANALYSIS.md).

Artifacts are ordered by attempt, creation time and ID, capped at 33. Metadata includes id, shopId/runId, attempt, nullable stepId/stepPosition, type, mimeType, sizeBytes, sha256, status, errorCode, createdAt and expiresAt, never storageKey. Types are SCREENSHOT/TRACE/CONSOLE/NETWORK/METADATA; status is PENDING/READY/FAILED. GET `/app/api/artifacts/:artifactId/download` returns `{url, expiresAt}` for an active tenant's READY, unexpired artifact, otherwise 404. The attachment URL is a bearer capability lasting at most 60 seconds; do not log/cache it. The endpoint uses no-store and no-referrer headers. Storage configuration errors return opaque 503 responses. See [privacy and retention](EVIDENCE.md).

Lists accept `limit` (default 25, maximum 100) and `offset` (default 0, maximum 100000). Run lists optionally accept monitorId. Ordering is createdAt descending, then UUID descending for stable ties. Offset pagination can shift as new records arrive. Duplicate/unknown query keys and invalid IDs are rejected.

Validation errors return 400/INVALID_INPUT with field names only. Missing bearer credentials return 401; invalid credentials retain Shopify's authentication challenge. Inactive shops return 403/SHOP_INACTIVE. Cross-tenant and absent entity lookups return the same 404/NOT_FOUND. Disabled-monitor writes and concurrent/stale updates return 409. Unsupported authenticated write methods return 405. Infrastructure failures remain opaque 503 responses with a request ID.

Shop creation and identity updates remain exclusively in the existing authenticated installation/GraphQL flow; there is no public Shop create endpoint. Monitoring UI, scheduling, rate limiting and full production hardening remain later phases.

## Incidents

GET `/app/api/incidents` returns `{incidents}` and accepts monitorId, status (OPEN/RESOLVED), limit and offset. Defaults and bounds match other lists. Order is lastSeenAt descending then ID descending. GET `/app/api/incidents/:incidentId` returns `{incident, occurrences}`, with limit/offset for occurrence history ordered by createdAt descending then ID descending. Missing or cross-tenant IDs return the same 404; inactive shops receive 403. Every route authenticates independently and uses no-store responses.

Incident fields include tenant/monitor identity, configKey, fingerprint, finding type/severity, fixed title/description, status, lifetime distinct-run occurrenceCount, firstSeenAt/lastSeenAt, lastSeenRunId/lastSeenRunCreatedAt, and nullable resolvedAt/resolvedRunId. Occurrences identify runId, attempt and findingId, not artifact keys or signed URLs. Fetch the authorized run to inspect findings/evidence. No public incident-write, mute or acknowledge endpoint exists. See [ordering, recovery and recurrence policy](INCIDENTS.md).
