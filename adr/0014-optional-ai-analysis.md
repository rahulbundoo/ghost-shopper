# 0014 Optional AI analysis

- Status: Accepted
- Date: 2026-09-30
- Source: AGENT.md Phase 8

## Context

AI interpretation is optional and may fail, time out or generate unsupported claims. Retrying an ambiguous request can incur duplicate cost. Technical facts and incident recovery must remain reliable without a provider.

## Decision

Run AI after deterministic completion and incident commit, in the existing asynchronous runner. Application defines the provider/repository ports, domain defines experience vocabulary and severity rules, contracts defines strict schemas, and adapters implement OpenAI HTTP and Prisma persistence. No new deployable service or external dependency is added.

AI is explicitly enabled by deployment configuration. Inputs consist of bounded masked public storefront images and allowlisted summaries. The versioned prompt provides no tools. Only validated experience interpretations are saved, in a separate AiAnalysis record labelled AI_ANALYSIS. AI never writes technical findings, scores, run outcomes or incidents.

A unique tenant/run/attempt reservation precedes transmission. Requests are one-shot with bounded timeout, output tokens and response size. Rates are configured and snapshotted; known usage and estimated cost survive model-output failure. Expired reservations fail without replay.

## Consequences

Deterministic success does not depend on AI availability. One runner slot remains occupied during the short AI tail. A crash before reservation can omit enrichment; a crash after transmission can leave usage unknown. There is no historical backfill or automatic reanalysis in Phase 8. Future coverage requirements may justify durable AI dispatch using the existing queue, but must preserve billing idempotency and privacy review.

Storefront images and model text are untrusted. Masking cannot guarantee that every sensitive visual detail is removed. Deployment opt-in requires approval for external evidence processing. Provider retention and spend controls require operational configuration.

## Alternatives

Putting AI inside deterministic completion would couple monitoring to provider failures. Automatic retries improve coverage but can duplicate charges. A new AI service or gateway adds infrastructure without a current requirement.

## Verification

Unit and controlled HTTP tests cover schemas, evidence limits, failure isolation, costs, fixed endpoint and no redirect/retry. Dedicated PostgreSQL tests cover concurrent reservations, tenant constraints, expired-request handling and redaction. Live model quality and provider compatibility require authorized development-store acceptance.
