# 0004: AI provider abstraction

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md

## Context

Optional AI interpretation must not couple business logic to a vendor.

## Decision

Application logic depends on an AiProvider port; vendor integration lives in adapters. Phase 8 implements OpenAI Responses with native Node fetch and existing Zod, avoiding an SDK dependency for one bounded endpoint. Models and rates are explicit deployment configuration. See [ADR 0014](0014-optional-ai-analysis.md).

## Consequences

Validate bounded structured outputs and version prompts. Provider failures cannot discard deterministic run results.

## Alternatives

Direct vendor calls in domain/application logic would couple orchestration and provider behavior.

## Verification

Provider contract/schema, HTTP transport and failure-isolation tests run in `pnpm check`.
