# Shopify subscriptions and atomic run allowances

Status: Accepted for Phase 11 implementation.

## Context

Billing needs a merchant-approved paid plan and limits that scheduled and manual runs cannot bypass. Browser work already uses immutable queued runs and retry-safe execution. Charging for each worker attempt would penalize retries and couple billing to browser behavior.

## Decision

Use one Shopify recurring USD plan, an application-owned time/run-limited trial, and configurable allowances. Keep billing disabled until explicitly configured and default provider charges to test mode. Use BillingProvider and BillingRepository ports in application, a Shopify GraphQL adapter, and PostgreSQL subscription/usage state. No new deployable service is introduced.

Reserve one usage unit atomically with each new run, serialized by the tenant subscription lock. Completed, failed and cancelled runs all retain that unit; retries do not add units. Verify subscriptions on the Billing screen and periodically in the existing runner. Paid access fails closed after one hour without verification. Never use callback parameters as payment proof or automatically retry charge creation.

## Consequences

Operators must coordinate web/runner policy and approve commercial pricing. Polling permits bounded cancellation lag and provider outages can pause paid monitoring. Existing admitted runs may finish after cancellation. Active-period usage cannot be pruned without changing accounting semantics. Multi-plan pricing, refunds, overages and billing webhooks are deferred. See [billing activation and acceptance](../docs/BILLING.md).
