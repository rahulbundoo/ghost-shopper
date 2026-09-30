# 0001: Modular monolith

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md

## Context

V1 needs clear boundaries with minimal operational overhead.

## Decision

Use two applications, web and runner, plus private pnpm workspace packages. Packages are internal modules, not network services.

## Consequences

Shared types and build tooling stay in one repository. The domain remains independent of infrastructure. Avoid microservices and duplicated business logic.

## Alternatives

A single undifferentiated application weakens boundaries; per-package services add unnecessary operations.

## Verification

Workspace build/typecheck and architectural import tests.
