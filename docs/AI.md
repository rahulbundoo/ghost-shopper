# AI analysis

Phase 8 adds optional experience analysis after the runner commits deterministic completion and incident updates. AI never changes the technical score, run outcome, or incident lifecycle. Results are labelled `AI_ANALYSIS`; technical findings remain `DETECTED`.

## Provider and output

Application owns the `AiProvider` port. `packages/ai` implements one OpenAI Responses API adapter using native Node fetch and existing Zod, with no additional external dependency. It uses strict JSON Schema output and independently validates the returned JSON. The endpoint is fixed, redirects are rejected, `store` is false, and no tools or browser actions are exposed. See the [official structured output guide](https://developers.openai.com/api/docs/guides/structured-outputs).

The immutable prompt version is `journey-analysis-v1`. Change the version whenever prompt/input semantics change. The result contains GOOD/WARNING/BAD, a separate 0–100 experience score, and at most ten findings. Findings have bounded plain-text title, description and evidence, a supplied screenshot step, confidence from 0 to 1, and one of the five closed experience types.

Severity is normalized by code: MOBILE_LAYOUT_ISSUE is LOW; UNCLEAR_PRICE, UNCLEAR_SHIPPING and CONFUSING_FLOW are MEDIUM; OBSTRUCTED_PURCHASE_ACTION is HIGH. CRITICAL, arbitrary types, duplicate type/step findings, references to absent screenshots, mobile findings on desktop and contradictory GOOD-with-findings results are rejected. Valid structure does not prove the interpretation is correct. Render model text as untrusted plain text, never HTML.

## Input and privacy

The runner retains up to three existing masked PNGs: OPEN_PRODUCT, SELECT_VARIANT and OPEN_CART. Each is capped at 2 MiB. Only screenshots with READY, unexpired tenant/run/attempt-scoped storage records can authorize a request. No checkout screenshots, traces, HTML, URLs, product/tenant IDs, arbitrary console messages, headers or error messages are sent. Inputs contain only device, bounded step enums/timings, technical finding types/severities/positions and those images. Screenshot payloads remain in memory; PostgreSQL stores their input hash and step references, not images or raw prompts.

Existing capture masks form inputs, editable content and frames. Masking is not a guarantee that all personal or sensitive page content is removed. Enable AI only for approved public synthetic storefront testing, after reviewing provider data handling and sample evidence. Do not test customer sessions or protected pages. `store: false` does not itself establish zero provider retention. Instructions treat all storefront content as untrusted evidence and prohibit acting on embedded instructions.

## Configuration and costs

AI is disabled unless `AI_ENABLED=true`. Merely setting `OPENAI_API_KEY` does not enable transmission. Supply a model supporting images and strict Responses output in `AI_MODEL`; there is no guessed default. Supply current USD prices per million tokens in `AI_INPUT_USD_PER_MILLION`, `AI_CACHED_INPUT_USD_PER_MILLION` and `AI_OUTPUT_USD_PER_MILLION`. Review rates when changing models. The key belongs only in the runner environment/secret manager.

`AI_TIMEOUT_MS` defaults to 20000 and cannot exceed 30000. `AI_MAX_OUTPUT_TOKENS` defaults to 2048 and is capped at 4096. Invalid optional AI configuration logs `AI_CONFIGURATION_INVALID` and disables AI without stopping technical monitoring. Restrict provider project spend independently; Phase 8 does not implement tenant billing or monthly quotas.

Each AiAnalysis stores provider, configured model, prompt version, reservation/request timestamp, response timestamp, provider latency, input hash, evidence step references, price snapshot, token usage, estimated USD cost, validated result and RUNNING/SUCCEEDED/FAILED status. Cost is `(uncached input × input rate + cached input × cached rate + output × output rate) / 1,000,000`, stored as a decimal with eight fractional digits. This is an estimate, not an invoice; unknown usage/cost is null, not zero. Known usage survives refusals, incomplete responses and invalid model JSON.

## Failure and idempotency

A unique tenant/run/attempt reservation is persisted before sending. Duplicate delivery never creates a second request. No automatic retries are made, including after timeouts, 429s, invalid results or ambiguous network errors: the first call may already have been billed. Failures record safe error codes, never provider error bodies or raw output. Response bodies are capped at 128 KiB.

Runner reconciliation marks reservations older than two minutes FAILED with `AI_INTERRUPTED`; it never sends them again. A failed database commit may therefore leave cost unknown even when the provider billed the call. Reconcile provider invoices separately. The provider timeout is inside this deadline; runner shutdown permits a bounded AI tail after technical completion.

AI enrichment is best effort. If the process dies after deterministic completion but before reservation, no AI record exists. Disabled AI, absent/oversized screenshots, lost ownership and unavailable reservation storage also leave no record; relevant skips/failures are logged. There is no historical backfill or reanalysis endpoint. This intentionally prioritizes reliable technical monitoring over AI coverage.

## Access and acceptance

Run-detail GET responses include a separate `aiAnalyses` array under the same authenticated, active-tenant checks. No public API invokes a provider or accepts prompts. Uninstall blocks new requests/merchant reads; an already-sent request cannot be recalled and may finish its audit record. Shop redaction cascades AI metadata.

Apply migration `202609300008_ai_analysis` before deploying. `pnpm check` covers simulated provider behavior, safe input/output bounds, failure isolation, tenant query predicates and controlled HTTP transport. `pnpm test:database` additionally checks real concurrent reservations, foreign keys, immutable completion, recovery and redaction on a dedicated migrated database.

Live acceptance remains separate: configure authorized test credentials/model/rates, approve screenshot transmission, run an approved development-store monitor, inspect the separate result and recorded usage, compare the estimate with provider usage, then test disabled AI and a rejected request. Unit/fixture success does not establish model quality or live API compatibility. Phase 9 adds merchant UI; Phase 10 adds alerting.
