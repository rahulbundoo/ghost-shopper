# 0002: Browser worker separation

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md

## Context

Browser execution is slow, resource-intensive and exposed to remote storefront content.

## Decision

Only the independent runner may execute Playwright. Web eventually creates runs and queues work asynchronously.

## Consequences

Workers can scale separately. Queue delivery and run states need idempotency. Phase 0 provides build boundaries only.

## Alternatives

Browser execution in HTTP requests violates latency and isolation requirements.

## Verification

ESLint blocks browser imports in web; later queue and isolation integration tests.
