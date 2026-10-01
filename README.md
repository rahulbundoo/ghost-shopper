# GhostShopper

Synthetic shopping for Shopify stores. The V1 journey stops at checkout initiation and never submits payment.

## Current status

Phase 12 adds encrypted sessions, shared API rate limits, durable artifact deletion, protected readiness, optional metadata-only Sentry reporting and backup/restore tooling. Apply all eleven migrations and follow [production hardening and acceptance](docs/HARDENING.md). These controls do not establish deployment readiness until the documented infrastructure and restore checks pass. Local operation remains Docker-free.

Phase 8 adds optional OpenAI experience analysis with versioned prompts, strict validated findings, separate tenant-scoped audit records and token/cost tracking. AI is disabled by default and cannot change technical outcomes or incidents. See [AI configuration and limits](docs/AI.md), [incident rules](docs/INCIDENTS.md), [analysis rules](docs/ANALYSIS.md) and [evidence setup](docs/EVIDENCE.md). Live Shopify acceptance still requires an authorized test store, PostgreSQL, Redis and private storage; AI additionally requires explicit evidence-transmission opt-in and provider configuration. [AGENT.md](AGENT.md) defines the build order.

Phase 11 adds an opt-in Shopify paid plan, trial, Billing screen and atomic run allowances. Apply all ten migrations and follow [billing configuration and acceptance](docs/BILLING.md). No price is selected automatically; billing defaults off and test mode defaults on.

## Run locally without Docker

Use Node 22.15+ within major 22 and pnpm 10.34.6. If needed, install pnpm with `npm install --global pnpm@10.34.6`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3000. The public shell runs without credentials and clearly indicates that setup is pending. Protected routes remain unavailable until configured; there is no authentication bypass.

For a real Shopify connection, follow [Shopify setup](docs/SHOPIFY_SETUP.md). Use a native or remote PostgreSQL database. Redis, MinIO, Docker and the runner are not needed for Phase 1.

Apply the migrations with `pnpm db:migrate`. See the [monitoring API](docs/MONITORING_API.md) for authenticated operations and [runner setup](docs/RUNNER.md) for native/remote Redis and S3 configuration. Set BROWSER_CHANNEL=chrome to use your installed Chrome without downloading a browser. In a second terminal, `pnpm dev:runner` builds and starts the queue consumer. Phase 9 adds merchant overview, monitor management, run/incident details, findings and private evidence screens. Phase 10 adds opt-in recurring scheduling and incident/recovery emails with bounded retries and spam prevention. Apply all ten migrations and follow [automation activation](docs/AUTOMATION.md); defaults do not send email or schedule runs. See [merchant UI and local preview](docs/MERCHANT_UI.md) and [Phase 11 billing](docs/BILLING.md).

| Command               | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`            | Build shared packages and start the local Node/Vite web server          |
| `pnpm dev:shopify`    | Start the official CLI tunnel and development-store preview             |
| `pnpm db:migrate`     | Apply reviewed Prisma migrations to DATABASE_URL                        |
| `pnpm build`          | Build both applications and all shared packages                         |
| `pnpm start`          | Serve the production web build directly with Node                       |
| `pnpm dev:runner`     | Build and run the asynchronous worker with Node                         |
| `pnpm test:queue`     | Test real BullMQ delivery with dedicated PostgreSQL and Redis           |
| `pnpm test:browser`   | Run controlled real-browser journeys without external services          |
| `pnpm test:storage`   | Check uploads and private downloads against a dedicated S3 test bucket  |
| `pnpm check`          | Lint, formatting, typecheck, unit and production HTTP integration tests |
| `pnpm test:database`  | Lifecycle/isolation tests against a migrated TEST_DATABASE_URL          |
| `pnpm security:check` | Audit the dependency lockfile                                           |
| `pnpm format`         | Format source and documentation                                         |

Root `.env` is optional for the public shell. Copy `.env.example` using `Copy-Item .env.example .env` in PowerShell, then fill in your own settings. Never commit secrets.

## Repository

`apps/web` is the Shopify application. `apps/runner` is the independent queue consumer and dispatch reconciler. Shared packages preserve domain, application, contracts and adapter boundaries. See [architecture](docs/ARCHITECTURE.md), [testing](docs/TESTING.md) and [operations](docs/OPERATIONS.md).

Optional Docker definitions from Phase 0 remain for CI/deployment; local commands above never invoke them.
