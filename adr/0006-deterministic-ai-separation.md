# 0006: Deterministic and AI separation

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md

## Context

Merchants must distinguish observed purchase failures from subjective interpretation.

## Decision

Keep deterministic findings authoritative and AI interpretations explicitly separate in contracts, storage and UI.

## Consequences

The monitoring engine succeeds without AI. AI must not invent finding types or critical severity.

## Alternatives

Merged AI/deterministic results would obscure evidence and failure causes.

## Verification

Independent analyzer tests and presentation labels when those phases are implemented.
