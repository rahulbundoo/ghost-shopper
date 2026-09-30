# Security

## Foundation controls

- Private workspace packages; exact tool versions and a frozen lockfile in CI.
- Strict TypeScript and typed linting.
- Dependency lifecycle scripts blocked by pnpm except explicit esbuild and Prisma allowlists.
- CI read-only repository permissions; dependency audit fails on high/critical advisories.
- Environment files and build artifacts excluded from Git and Docker context.
- Local services bind only to 127.0.0.1. Example credentials are public local defaults.
- Artifact bucket initialization explicitly disables anonymous access; infrastructure tests assert denial.
- Application images run as the unprivileged node user.

## Shopify shell controls

- Official SDK session-token authentication, managed installation and signed-webhook verification; no custom authentication bypass.
- Offline sessions with expiring-token support, tenant foreign keys and tenant-scoped Shop mutations.
- GraphQL shop identity is validated and must match the authenticated shop before persistence.
- No product, customer or order scopes requested in Phase 1. No customer data is collected.
- Uninstall deletes the tenant's sessions; signed shop-redaction requests remove only inactive tenants.
- Server-only credentials, no-store responses, Shopify frame headers and opaque error responses. SDK log messages are replaced with structured event metadata to avoid credential leakage.
- Tokens remain in PostgreSQL for the official session adapter; use encryption at rest, TLS and restricted database access in deployed environments.

## Required before merchant testing

Phase 3 job payloads contain only a version, shopId and runId. The runner validates the payload and rechecks tenant/installation/monitor state in PostgreSQL before claiming. Terminal runs cannot be replayed; lease tokens fence stale writes and are excluded from API responses. Uninstall revokes active leases. Redis must be private/authenticated, use TLS remotely, persistence and noeviction. Raw exceptions are replaced by safe failure codes before BullMQ persists them. Future browser executors must honor cancellation; leases alone cannot guarantee exactly-once remote effects.

Phase 2's resource routes require an explicit Shopify bearer token before reading request payloads. Tenant IDs come only from verified sessions; strict schemas reject mass assignment. Each repository operation checks active installation and tenant scope. Compound foreign keys prevent cross-shop run/monitor references, version checks prevent lost monitor edits, and error responses do not distinguish another tenant's entity from a nonexistent entity. Bodies are limited to 16 KiB and lists to 100 records. No generic run-state or destructive monitor API is exposed.

Product/variant GIDs are syntax-validated at configuration time. Phase 4 checks the exact product ID and available variant against public JSON on the authenticated shop's synchronized storefront domain, then verifies the cart contents. No new product scope is requested. Arbitrary storefront URLs are not accepted by the monitoring API.

Phase 4 uses fresh browser contexts/processes, a host-restricted CONNECT proxy that pins validated public IPv4 addresses, explicit no-follow redirect handling, service-worker/WebSocket blocking and a cart-write allowlist. The checkout response is replaced with inert content before scripts or payment controls run. Step URLs redact query strings and checkout tokens. See [browser safety and limits](BROWSER.md); these controls do not replace deployed egress isolation or a browser security boundary.

Phase 5 stores evidence in a private bucket with server-generated keys and lease-fenced upload acknowledgement. Download routes independently authenticate the active shop and require READY, unexpired metadata before signing a link of at most 60 seconds. Raw console/exception text and network headers/bodies are omitted from JSON. Screenshots mask form fields/iframes, but native traces and other visible text remain potentially sensitive. Do not claim full redaction. Bucket private-access policy, encryption, lifecycle deletion, trace-disk quotas and post-redaction object cleanup require deployment verification. See [evidence security and retention limits](EVIDENCE.md).

Live Shopify installation, restart, uninstall/reinstall and cross-tenant acceptance must be verified with real development stores. External egress enforcement, streaming resource quotas, rate limits, signed artifact access and full retention rules remain later-phase requirements. Do not treat the application as production hardened.

Never log tokens, session credentials, sensitive headers or secrets. Never send unnecessary merchant data to AI providers. Never submit payment.

## Environment boundaries

Phase 8 AI is disabled by default. Explicit opt-in sends only bounded masked public storefront PNGs and allowlisted step/finding metadata to a fixed HTTPS provider endpoint, with redirects and tools disabled. No checkout, trace, HTML, URL or arbitrary diagnostic text enters the prompt. Form masking is not complete visual redaction; review evidence/provider retention before enabling. Keys and raw provider errors are never logged. Strict output validation and code-owned severity prevent arbitrary taxonomy or critical classifications, but cannot prove an interpretation correct. Treat result text as untrusted plain text. Reads require active tenant authentication; new requests verify active installation and tenant-scoped READY evidence. See [privacy, idempotency and cost limits](AI.md).

Compose is for local development and disposable CI only. Use separate credentials and infrastructure for staging and production. Rotate any real secret accidentally exposed; do not treat deletion from a file as remediation.
