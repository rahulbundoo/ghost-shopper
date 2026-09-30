# 0003: BullMQ job queue

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md

## Context

Monitoring must run asynchronously with retry, backoff and job identification.

## Decision

Use Redis and BullMQ in Phase 3, with explicit run state validation and duplicate-delivery protection.

## Consequences

Operate Redis with persistence and noeviction. Phase 3 implements the producer, reconciler and worker. Local development uses native/remote Redis without Docker; optional Phase 0 infrastructure remains in CI. [ADR 0009](0009-durable-run-dispatch.md) records delivery and ownership decisions.

## Alternatives

Kafka, RabbitMQ and custom distributed job scheduling add out-of-scope complexity.

## Verification

Phase 0 checks Redis health/policy; Phase 3 adds retry and idempotency tests.
