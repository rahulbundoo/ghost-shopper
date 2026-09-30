# 0007: Shopify shell and minimal tenant persistence

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md Phase 1

## Decision

Use Shopify's official React Router SDK with managed installation and expiring offline tokens. Use its Prisma session adapter with Prisma 6.19.3, the supported peer version, and PostgreSQL. React Router is pinned to compatible major 7. Polaris web components and App Bridge come from the SDK AppProvider.

Phase 1 reads only shop identity and requests no optional access scopes. Tenant identity comes from authenticated Shopify sessions/webhooks. The official session `shop` property maps to database shopId and references Shop.

Keep routes in web, configuration validation in config, schemas in contracts, persistence in database and Shopify adaptation in shopify. No domain dependency on infrastructure is introduced.

## Consequences

Shop and Session persistence is implemented now because Phase 1 explicitly requires durable shop registration/authentication. Broader domain persistence remains Phase 2. Local development runs Node with native/remote PostgreSQL; Docker remains optional CI tooling.

The Prisma config loader's deepmerge-ts transitive dependency is overridden to 8.0.0 for GHSA-ggr8-5vv4-36mx. The plain-object merge API used by Prisma remains compatible; schema generation/validation/builds verify this configuration. Remove the override when upgrading to an officially compatible fixed Prisma version.

## Verification

Unit checks validate config, GraphQL identity and webhook signatures. HTTP tests run the production Node server. Database tests exercise session durability and tenant lifecycle isolation. Installation acceptance requires a real Shopify development app/store and is documented separately.
