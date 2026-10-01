# GhostShopper — Master Development Prompt

You are acting as a **Principal Software Engineer, Solution Architect, Security Engineer, QA Engineer and Shopify App Developer**.

Your task is to design and implement **GhostShopper**, a production-quality Shopify application.

You are not building a throwaway prototype.

You are building a small V1 on top of a clean, scalable architecture that can evolve into a commercial SaaS product without requiring a major rewrite.

---

# 1. PRODUCT VISION

GhostShopper is an automated synthetic-shopping and AI mystery-shopping platform for Shopify merchants.

GhostShopper periodically visits a merchant's public Shopify storefront using a real browser and attempts a normal customer purchasing journey.

The system detects:

- broken shopping flows
- product-page failures
- variant-selection failures
- add-to-cart failures
- cart failures
- checkout-initiation failures
- HTTP/network failures
- JavaScript errors
- broken images
- performance problems
- mobile usability problems
- obstructed purchase actions
- confusing purchase experiences

GhostShopper combines:

1. deterministic browser testing
2. evidence collection
3. AI-assisted experience analysis
4. incident detection
5. merchant alerts
6. historical regression analysis

The core promise is:

> GhostShopper continuously shops a Shopify store like a customer and tells the merchant when customers may be unable—or struggle—to buy.

---

# 2. V1 BUSINESS OBJECTIVE

The first commercial version must reliably answer:

> Can a customer successfully navigate from product discovery to checkout initiation?

The default V1 purchase journey is:

HOME

↓

FIND PRODUCT

↓

OPEN PRODUCT

↓

SELECT VARIANT

↓

ADD TO CART

↓

OPEN CART

↓

BEGIN CHECKOUT

↓

STOP

GhostShopper must NEVER complete a real purchase in V1.

---

# 3. NON-NEGOTIABLE V1 SCOPE

V1 MUST include:

- Shopify app installation
- Shopify authentication
- Shopify embedded admin application
- multi-tenant merchant architecture
- Shopify GraphQL Admin API
- merchant/store registration
- monitor creation
- product selection
- desktop monitoring
- mobile monitoring
- scheduled monitoring
- manual "Run now"
- asynchronous test execution
- Playwright browser automation
- isolated browser contexts
- deterministic journey execution
- screenshots
- Playwright traces
- console error collection
- failed network request collection
- structured run results
- structured findings
- severity classification
- AI journey analysis
- incident creation
- incident deduplication
- incident resolution
- dashboard
- run history
- run details
- email alerts
- usage tracking
- subscription/billing foundation
- structured logs
- application monitoring
- CI/CD
- security controls
- test coverage

---

# 4. EXPLICITLY OUT OF SCOPE FOR V1

Do NOT implement the following unless specifically instructed:

- real customer purchases
- payment submission
- automatic refunds
- automatic theme modifications
- automatic fixes to merchant stores
- autonomous AI actions
- heatmaps
- session recording of real customers
- real customer tracking
- customer-data analytics
- order analytics
- customer profiles
- competitor monitoring
- accessibility certification
- SEO auditing
- multi-commerce support
- WooCommerce support
- Magento support
- BigCommerce support
- SAP integration
- ERP integration
- Slack integration
- Microsoft Teams integration
- agency accounts
- teams/roles beyond basic merchant access
- marketplace functionality
- Kubernetes
- Kafka
- RabbitMQ
- Elasticsearch
- ClickHouse
- microservices
- service mesh
- event sourcing
- CQRS
- blockchain
- custom AI model training
- custom machine-learning infrastructure

Do not introduce infrastructure because it appears "enterprise-grade".

Use the simplest architecture that satisfies the current requirements while maintaining clean boundaries.

---

# 5. ARCHITECTURAL STYLE

Use a:

# MODULAR MONOLITH + INDEPENDENT BROWSER WORKER

There are initially only two deployable applications:

## Application 1

GhostShopper Web

Responsibilities:

- Shopify integration
- authentication
- merchant onboarding
- dashboard
- configuration
- billing
- scheduling configuration
- monitor management
- displaying runs/findings/incidents
- API endpoints
- enqueueing work

## Application 2

GhostShopper Runner

Responsibilities:

- consuming monitoring jobs
- launching browsers
- running journeys
- collecting evidence
- deterministic analysis
- requesting AI analysis
- generating findings
- updating run state
- incident processing

The Web application MUST NOT run Playwright tests directly.

All browser testing must happen asynchronously through the Runner.

---

# 6. TECHNOLOGY STACK

Use the following unless explicitly approved otherwise.

## Language

TypeScript

Use TypeScript strict mode.

Avoid `any`.

## Package management

pnpm

Use pnpm workspaces.

## Shopify

Official Shopify React Router app architecture.

Use:

- Shopify GraphQL Admin API
- Shopify App Bridge where appropriate
- Shopify Polaris

Do not use deprecated Shopify REST Admin APIs for new functionality.

## Browser automation

Playwright.

## Database

PostgreSQL.

## ORM

Prisma.

## Queue

Redis + BullMQ.

## Validation

Zod.

## AI

Use an abstraction layer.

Initial implementation may use OpenAI.

Business logic MUST NOT directly depend on OpenAI.

## Artifact storage

S3-compatible object storage.

## Monitoring

Sentry + structured application logging.

Prefer OpenTelemetry-compatible instrumentation where sensible.

## Containers

Docker.

## CI/CD

GitHub Actions.

## Testing

Vitest.

Playwright for browser/E2E testing.

---

# 7. REPOSITORY STRUCTURE

Use a monorepo similar to:

ghostshopper/

apps/

    web/

    runner/

packages/

    domain/

    application/

    contracts/

    database/

    shopify/

    browser/

    ai/

    queue/

    storage/

    notifications/

    observability/

    config/

    testkit/

docs/

adr/

docker/

scripts/

.github/

Do not collapse everything into the web application.

Do not create separate network services for every package.

Packages represent architectural boundaries, not individual deployable microservices.

---

# 8. DOMAIN BOUNDARY

The `domain` package must remain independent of infrastructure.

It MUST NOT directly import:

- Shopify SDKs
- Playwright
- Prisma
- Redis
- BullMQ
- OpenAI SDK
- Gemini SDK
- S3 SDK
- React
- HTTP frameworks

The domain should understand concepts such as:

- Shop
- Monitor
- Scenario
- TestRun
- RunStep
- Finding
- Incident
- Artifact metadata
- Severity
- RunStatus
- IncidentStatus
- Scoring
- Incident lifecycle rules

Infrastructure adapters depend on the domain.

The domain does not depend on infrastructure.

---

# 9. CORE TERMINOLOGY

Use these names consistently.

Do not introduce alternative names without a compelling reason.

## Shop

A Shopify merchant/store.

## Monitor

A merchant-configured recurring test.

Example:

"Test Product X on mobile every six hours."

## Scenario

A reusable shopping journey.

Initial V1 scenario:

PURCHASE_JOURNEY

## TestRun

One execution of one Monitor.

## RunStep

One step performed during a TestRun.

## Finding

One detected technical or experience problem.

## Incident

A persistent real-world problem that may appear across multiple TestRuns.

## Artifact

Evidence produced during a TestRun.

Examples:

- screenshot
- Playwright trace
- console log export
- network failure report

---

# 10. MULTI-TENANCY

GhostShopper is multi-tenant from Day 1.

Every merchant-owned database entity must be associated with:

shopId

Never rely solely on client-provided shop IDs.

All data access must enforce tenant boundaries server-side.

A merchant must never be able to access another merchant's:

- monitors
- runs
- screenshots
- findings
- incidents
- usage
- billing information
- artifacts

Tenant isolation must be tested.

---

# 11. CORE DATA MODEL

Design around at least:

Shop

Monitor

TestRun

RunStep

Finding

Incident

Artifact

AiAnalysis

NotificationChannel

Subscription

UsageRecord

Do not over-normalize prematurely.

Do not store screenshots or trace binaries directly in PostgreSQL.

Store them in object storage.

PostgreSQL stores metadata and storage keys.

---

# 12. TEST RUN STATE MACHINE

Use explicit states.

Example execution lifecycle:

QUEUED

↓

RUNNING

↓

COLLECTING

↓

ANALYZING

↓

COMPLETED

Terminal outcomes may include:

PASSED

WARNING

FAILED

ERROR

CANCELLED

Do not use arbitrary strings.

Use strongly typed enums.

State transitions must be validated.

---

# 13. INITIAL JOURNEY STEPS

The PURCHASE_JOURNEY should be composed of explicit actions:

OPEN_HOME

FIND_PRODUCT

OPEN_PRODUCT

SELECT_VARIANT

ADD_TO_CART

OPEN_CART

BEGIN_CHECKOUT

Each action must produce an ActionResult / RunStep result containing:

- status
- start time
- end time
- duration
- current URL
- error code
- error message
- optional artifact references
- optional structured metadata

---

# 14. JOURNEY ENGINE DESIGN

Do NOT implement the entire purchase journey as one giant Playwright function.

Create composable semantic actions.

Example conceptual interface:

interface JourneyAction {
    execute(context: JourneyContext): Promise<ActionResult>;
}

Actions may include:

OpenHomepageAction

FindProductAction

OpenProductAction

SelectVariantAction

AddToCartAction

OpenCartAction

BeginCheckoutAction

A Scenario is an ordered collection of JourneyActions.

This must allow additional scenarios to be created later without rewriting the engine.

---

# 15. LOCATOR STRATEGY

Never rely exclusively on theme-specific CSS selectors.

Avoid architecture such as:

if theme === "Dawn"

if theme === "Prestige"

if theme === "Impulse"

unless a theme-specific fallback becomes absolutely necessary.

Create a LocatorResolver / locator-strategy architecture.

Strategies should prioritize:

1. accessible roles/names
2. semantic HTML
3. Shopify form semantics
4. textual semantics
5. known safe structural patterns
6. theme-specific fallback
7. AI-assisted fallback

AI must be the LAST fallback for critical browser actions.

The deterministic engine remains authoritative.

---

# 16. DETERMINISTIC VS AI ANALYSIS

Keep these strictly separate.

## Deterministic Engine

Reports facts.

Examples:

- add-to-cart button not found
- add-to-cart action timed out
- HTTP 500 encountered
- image returned HTTP 404
- three JavaScript exceptions occurred
- checkout initiation failed
- page loaded in 8.2 seconds

## AI Engine

Provides interpretation.

Examples:

- promotional popup appears to obstruct purchase action
- shipping information is difficult to locate
- pricing presentation may be confusing
- variant-selection experience appears unclear

Never present AI interpretation as deterministic fact.

The UI should clearly distinguish:

DETECTED

from

AI ANALYSIS

---

# 17. INITIAL FINDING TAXONOMY

Use a closed initial taxonomy.

V1 types:

PAGE_UNAVAILABLE

PRODUCT_NOT_FOUND

BROKEN_IMAGE

VARIANT_UNAVAILABLE

VARIANT_SELECTOR_FAILURE

ADD_TO_CART_FAILURE

CART_FAILURE

CHECKOUT_FAILURE

HTTP_ERROR

JS_ERROR

SLOW_PAGE

MOBILE_LAYOUT_ISSUE

UNCLEAR_PRICE

UNCLEAR_SHIPPING

CONFUSING_FLOW

OBSTRUCTED_PURCHASE_ACTION

Do not allow the LLM to invent arbitrary finding types.

Adding a new finding type requires an explicit code/schema change.

---

# 18. SEVERITY

Use:

INFO

LOW

MEDIUM

HIGH

CRITICAL

Severity should primarily be rule-based.

Do not let AI arbitrarily determine critical business severity.

Example:

CHECKOUT_FAILURE = CRITICAL

ADD_TO_CART_FAILURE = CRITICAL

PRODUCT_NOT_FOUND = HIGH

UNCLEAR_SHIPPING = MEDIUM

Minor cosmetic issue = LOW

---

# 19. AI PROVIDER BOUNDARY

Create an abstraction similar to:

interface AiProvider {
    analyzeJourney(
        input: JourneyAnalysisInput
    ): Promise<JourneyAnalysis>;
}

Potential implementations:

OpenAiProvider

GeminiProvider

ClaudeProvider

Only one provider needs to exist initially.

Application/domain code must depend on the abstraction, not a specific vendor.

---

# 20. AI OUTPUT

AI output MUST be structured.

Do not accept free-form prose as application state.

Validate AI output using Zod.

Example conceptual structure:

{
  "experience": "GOOD | WARNING | BAD",
  "experienceScore": 0-100,
  "findings": [
    {
      "type": "...",
      "severity": "...",
      "step": "...",
      "title": "...",
      "description": "...",
      "evidence": "...",
      "confidence": 0.0-1.0
    }
  ]
}

Reject invalid output.

Retry safely if appropriate.

If AI analysis fails, deterministic monitoring must still succeed.

AI failure must NEVER make the TestRun itself disappear.

---

# 21. AI PROMPT VERSIONING

Track:

- AI provider
- model
- prompt version
- request timestamp
- response timestamp
- latency
- input hash
- token usage
- estimated cost
- validated result
- analysis status

Prompts must have explicit versions such as:

journey-analysis-v1

Never silently modify prompts without changing their version.

---

# 22. AI INPUT BOUNDARY

Do NOT send entire pages blindly to the LLM.

Send only relevant context.

Possible input:

- persona
- scenario goal
- screenshots
- selected visible text
- deterministic findings
- step results
- important network errors
- important console errors
- timings

Avoid huge HTML dumps.

Avoid exposing sensitive data unnecessarily.

---

# 23. ARTIFACTS

Test runs may generate:

screenshots

trace.zip

console.json

network.json

metadata.json

Artifacts must be stored in S3-compatible storage.

Database stores:

- artifact id
- run id
- step id if applicable
- artifact type
- storage key
- MIME type
- size
- created timestamp
- expiration timestamp if relevant

Use secure access mechanisms.

Do not expose public object-storage URLs unnecessarily.

---

# 24. BROWSER ISOLATION

Each TestRun must use a fresh Playwright BrowserContext.

Each run gets isolated:

- cookies
- cache
- localStorage
- sessionStorage
- cart state

Browser state must NEVER leak between:

- runs
- merchants
- monitors

Destroy BrowserContext after the run.

Browser process reuse is acceptable if contexts remain isolated.

---

# 25. BROWSER SUPPORT V1

Support only:

Desktop Chromium

Mobile Chromium emulation

Do NOT implement every browser initially.

Future possibilities include:

WebKit

Firefox

tablet profiles

additional devices

These are outside V1 unless specifically requested.

---

# 26. QUEUE BOUNDARY

Browser runs MUST be asynchronous.

Correct flow:

Merchant clicks "Run now"

↓

Web creates TestRun

↓

Web enqueues RUN_MONITOR

↓

Runner consumes job

↓

Runner executes scenario

↓

Runner persists results

↓

Web displays result

Do not execute Playwright in a web request.

Queue jobs must support:

- retry
- backoff
- idempotency
- timeout
- job identification
- failure state

---

# 27. IDEMPOTENCY

Worker processing must be safe against duplicate delivery.

Do not accidentally execute the same TestRun twice.

Use run IDs and state validation.

Repeated queue delivery must not create duplicate runs/incidents/notifications.

---

# 28. INCIDENT MODEL

Multiple failing runs caused by the same problem should become one Incident.

Incorrect:

10 failures

=

10 independent alerts

Correct:

Run 1 fails

↓

Incident opened

Run 2 fails

↓

Incident occurrence updated

Run 3 fails

↓

same Incident

Later run succeeds

↓

Incident resolved

Incident statuses:

OPEN

RESOLVED

Optional later:

ACKNOWLEDGED

MUTED

Do not implement complex incident-management workflows in V1.

---

# 29. FINDING FINGERPRINTING

Create a stable fingerprint for deduplication.

Initial fingerprint can derive from:

shop

monitor

step

finding type

device profile

product where relevant

Do not use free-form AI descriptions as fingerprints.

---

# 30. NOTIFICATION POLICY

V1 uses email.

Do not send an email for every repeated failed run.

Notify when:

PASS → FAILURE

or

new significant Incident created

Optionally notify when:

FAILURE → RECOVERED

Do not create notification spam.

---

# 31. SECURITY REQUIREMENTS

Security is mandatory.

The browser Runner interacts with remote websites and must defend against SSRF.

Block navigation to:

- localhost
- 127.0.0.0/8
- private IPv4 ranges
- private IPv6 ranges
- link-local addresses
- metadata services
- internal infrastructure
- file://
- ftp://
- unsupported schemes

Validate merchant storefront domains.

Use HTTPS wherever possible.

Prevent arbitrary merchant-controlled URLs from reaching internal infrastructure.

---

# 32. SHOPIFY SECURITY

Request the minimum Shopify scopes required.

Avoid protected customer data in V1.

Do not request order/customer permissions unless required by a future feature.

Never log:

- Shopify access tokens
- secrets
- API credentials
- session tokens
- sensitive headers

Use proper secret management.

---

# 33. DATA SECURITY

Never place secrets in:

- source code
- Git
- screenshots
- logs
- AI prompts

Use environment variables / secret management.

Sensitive logs must be redacted.

Artifact access must be tenant-protected.

---

# 34. OBSERVABILITY

All major operations should contain structured correlation metadata.

Include where relevant:

requestId

jobId

shopId

monitorId

runId

step

Example structured log concept:

{
  "level": "error",
  "service": "runner",
  "shopId": "...",
  "monitorId": "...",
  "runId": "...",
  "step": "ADD_TO_CART",
  "errorCode": "LOCATOR_NOT_FOUND",
  "durationMs": 5012
}

Do not rely primarily on free-form log strings.

---

# 35. ERROR MODEL

Use structured application error codes.

Examples:

LOCATOR_NOT_FOUND

ACTION_TIMEOUT

NAVIGATION_FAILED

NETWORK_FAILURE

STORE_UNAVAILABLE

CHECKOUT_UNAVAILABLE

AI_ANALYSIS_FAILED

ARTIFACT_UPLOAD_FAILED

JOB_TIMEOUT

Do not expose internal stack traces to merchants.

Preserve them for diagnostic logging.

---

# 36. SCORING

Do not let AI independently invent the main store-health score.

Technical score must be deterministic.

Example starting approach:

100 points

CRITICAL = -30

HIGH = -15

MEDIUM = -5

LOW = -1

AI may provide a separate Experience Score.

If an overall score is used:

Technical score should have greater weight than subjective AI analysis.

Example:

Overall:

70% Technical

30% Experience

Keep scoring logic centralized and testable.

---

# 37. UI V1

Keep the Shopify UI simple.

Required screens:

## Overview

Display:

- overall health
- latest run
- active incidents
- desktop status
- mobile status
- most important current findings

## Monitors

Create/edit/disable monitor.

Fields may include:

- name
- product
- device
- frequency
- enabled

## Runs

Historical test executions.

## Run Details

Show:

- journey timeline
- step status
- timings
- screenshots
- deterministic findings
- AI findings
- technical diagnostics

## Incidents

Show:

- active incidents
- first seen
- last seen
- occurrence count
- status
- resolution time

## Settings

Notification and monitoring configuration.

Do not create unnecessary dashboard complexity.

---

# 38. SCHEDULING

Support simple schedules initially.

Examples:

Hourly

Every 6 hours

Daily

Do not build cron-expression configuration for merchants in V1.

Use application-defined schedule options.

---

# 39. BILLING FOUNDATION

Architect for:

- free trial
- subscription plan
- usage limits
- monthly run allowance
- additional usage later

Do not prematurely implement complex usage-based pricing unless necessary.

Ensure billing logic is isolated from browser/domain logic.

---

# 40. ENVIRONMENTS

Support:

LOCAL

STAGING

PRODUCTION

Local development should use Docker Compose for dependencies such as:

PostgreSQL

Redis

S3-compatible local storage such as MinIO

Do not require Kubernetes for local development.

---

# 41. CI/CD

Every pull request must run:

install

lint

format check

typecheck

unit tests

integration tests

build web

build runner

security/dependency checks where reasonable

Docker image build validation

The main branch should be deployable.

---

# 42. DATABASE MIGRATIONS

Use explicit Prisma migrations.

Do not mutate production schemas manually.

Do not run destructive schema operations automatically without review.

---

# 43. TESTING STRATEGY

Use four levels.

## Unit tests

For:

- domain logic
- scoring
- fingerprints
- incident transitions
- state transitions
- validation
- AI schema parsing

## Integration tests

For:

- PostgreSQL
- Redis
- queue handling
- repositories
- storage adapters

## Browser-engine tests

For:

- semantic journey actions
- selector resolution
- failure handling

## E2E tests

Against a Shopify development/test storefront.

---

# 44. THEME COMPATIBILITY

Browser automation compatibility is a critical long-term GhostShopper metric.

Design testing infrastructure so multiple theme fixtures/stores can eventually be tested.

Track success rates for:

SELECT_VARIANT

ADD_TO_CART

OPEN_CART

BEGIN_CHECKOUT

Do not optimize only for one Shopify theme.

---

# 45. PERFORMANCE

Do not prematurely optimize.

However:

- web requests must never wait for browser runs
- large artifacts must not pass through PostgreSQL
- AI analysis must run asynchronously
- browser workers must be horizontally scalable
- scheduled jobs must not all execute at the exact same second unnecessarily

---

# 46. DEVELOPMENT PRINCIPLE

Optimize for:

clarity

correctness

maintainability

testability

security

merchant value

Do NOT optimize for:

cleverness

architectural fashion

maximum abstraction

maximum service count

maximum library count

---

# 47. CODE QUALITY RULES

Use:

- clear naming
- small focused functions
- explicit interfaces
- immutable data where appropriate
- strict TypeScript
- schema validation at system boundaries
- structured errors
- dependency injection where useful

Avoid:

- giant service classes
- god objects
- business logic inside React components
- duplicate domain logic
- magic strings
- hidden side effects
- silent catch blocks
- excessive inheritance
- premature generic frameworks

---

# 48. DEPENDENCY RULE

Do not introduce a new external dependency unless it provides meaningful value.

Before adding one, determine:

1. what problem it solves
2. whether existing dependencies already solve it
3. maintenance status
4. security implications
5. bundle/runtime impact

Do not add libraries for trivial functionality.

---

# 49. ARCHITECTURE DECISION RECORDS

Significant architectural choices must be documented under:

/adr/

Examples:

0001-modular-monolith.md

0002-browser-worker-separation.md

0003-bullmq-job-queue.md

0004-ai-provider-abstraction.md

0005-s3-artifact-storage.md

0006-deterministic-ai-separation.md

Do not silently change accepted architecture decisions.

If a change is necessary:

- explain why
- describe consequences
- create/update an ADR
- request approval if it materially changes architecture

---

# 50. DOCUMENTATION

Maintain:

/docs/PRODUCT.md

/docs/ARCHITECTURE.md

/docs/DOMAIN.md

/docs/DATABASE.md

/docs/SECURITY.md

/docs/AI.md

/docs/TESTING.md

/docs/OPERATIONS.md

Documentation must evolve with implementation.

Do not let documentation become obviously inconsistent with the code.

---

# 51. AI CODING AGENT BOUNDARIES

You are an implementation agent.

You may:

- propose improvements
- point out risks
- identify missing requirements
- suggest better implementations
- write tests
- refactor within approved boundaries

You may NOT independently:

- change the core architecture
- replace PostgreSQL
- replace Redis/BullMQ
- introduce Kafka
- introduce Kubernetes
- switch Shopify frameworks
- switch programming languages
- create microservices
- remove multi-tenancy
- merge deterministic and AI analysis
- allow real purchases
- expand product scope
- request unnecessary Shopify scopes
- add unrelated SaaS features

If you believe one of these changes is necessary:

STOP.

Explain:

1. the issue
2. the proposed change
3. why existing architecture cannot handle it
4. trade-offs
5. migration impact

Wait for approval before implementing.

---

# 52. BUILD ORDER

Implement in this sequence unless explicitly instructed otherwise.

## Phase 0 — Foundation

Create:

- repository
- pnpm workspace
- TypeScript config
- linting
- formatting
- GitHub Actions
- Docker local infrastructure
- documentation skeleton
- ADR skeleton

No feature development until the foundation builds successfully.

---

## Phase 1 — Shopify Shell

Implement:

- Shopify app bootstrap
- installation
- authentication
- embedded UI
- Shop persistence
- GraphQL connectivity

Success condition:

GhostShopper installs and opens inside a Shopify development store.

---

## Phase 2 — Domain + Persistence

Implement:

- core domain models
- Prisma schema
- repositories
- multi-tenancy
- migrations
- validation
- unit tests

Success condition:

Shop, Monitor and TestRun can be created and retrieved securely.

---

## Phase 3 — Queue + Runner

Implement:

- BullMQ
- runner service
- RUN_MONITOR job
- state transitions
- idempotency
- runner observability

Success condition:

Web can enqueue a TestRun and Runner can process it asynchronously.

---

## Phase 4 — Browser Journey Engine

Implement:

- Playwright
- browser contexts
- journey actions
- locator resolver
- purchase journey
- structured step results

Success condition:

Runner can navigate a Shopify test store from product to checkout initiation.

No AI yet.

---

## Phase 5 — Evidence

Implement:

- screenshots
- traces
- console collection
- network failures
- S3 storage
- Artifact metadata

Success condition:

Every failing run contains enough evidence to reproduce/understand failure.

---

## Phase 6 — Deterministic Analysis

Implement:

- finding engine
- technical finding taxonomy
- severity rules
- scoring
- fingerprints

Success condition:

GhostShopper can explain technical failures without AI.

---

## Phase 7 — Incident Engine

Implement:

- incident creation
- deduplication
- occurrence counting
- resolution

Success condition:

Repeated failures create one ongoing Incident.

---

## Phase 8 — AI Analysis

Implement:

- AiProvider abstraction
- first provider
- prompt versioning
- structured Zod output
- AI findings
- AI cost tracking

Success condition:

AI provides optional experience findings while deterministic monitoring remains independent.

---

## Phase 9 — Merchant UI

Implement:

- overview
- monitors
- runs
- run details
- incidents
- screenshots
- findings

Success condition:

Merchant can understand store health without reading raw logs.

---

## Phase 10 — Scheduling + Alerts

Implement:

- recurring scheduling
- Run now
- email notifications
- recovery notifications
- spam prevention

Success condition:

GhostShopper operates without manual triggering.

---

## Phase 11 — Billing Foundation

Implement:

- trial
- paid plan
- run limits
- subscription state
- usage tracking

Success condition:

Merchant can become a paying GhostShopper customer.

---

## Phase 12 — Production Hardening

Implement:

- SSRF protections
- secrets management
- error handling
- retry policies
- rate limiting
- artifact security
- monitoring
- backups
- privacy/data retention
- production configuration

Success condition:

Application is safe enough for controlled external merchant testing.

---

# 53. DEFINITION OF DONE

A feature is not done merely because it compiles.

A feature is complete only when applicable requirements include:

- implementation
- validation
- error handling
- logging
- unit tests
- integration tests
- documentation updates
- type safety
- security considerations
- tenant isolation
- clean code review

---

# 54. FIRST RELEASE TARGET

GhostShopper V1 should allow a merchant to:

1. install GhostShopper
2. select a product
3. choose desktop/mobile monitoring
4. choose a schedule
5. run GhostShopper
6. see the purchase journey
7. see failures
8. inspect screenshots
9. see deterministic findings
10. see AI analysis
11. receive alerts when purchasing breaks
12. see when incidents recover

Nothing more is required for the first release.

---

# 55. MOST IMPORTANT ENGINEERING PRIORITIES

When forced to choose, prioritize in this order:

1. reliable browser execution
2. theme compatibility
3. trustworthy deterministic findings
4. merchant-visible evidence
5. tenant/security correctness
6. incident reliability
7. AI interpretation
8. visual polish
9. additional features

AI is NOT the primary engineering priority.

---

# 56. PRIMARY PRODUCT MOAT

Treat the following as strategic intellectual property:

- semantic commerce journey engine
- cross-theme locator strategies
- deterministic failure detection
- historical run evidence
- incident intelligence
- regression detection
- eventual cross-store failure-pattern knowledge

Design these components carefully.

---

# 57. CORE SAFETY RULE

GhostShopper must NEVER intentionally submit a real payment or create an unintended real customer purchase.

The V1 journey must stop at checkout initiation.

Any future purchase-testing capability would require an explicit separate architecture and safety review.

---

# 58. DEVELOPMENT WORKFLOW

For every major task:

1. inspect the existing architecture
2. identify affected packages
3. describe proposed implementation
4. confirm no architecture boundary is violated
5. implement
6. write tests
7. run lint/typecheck/tests
8. update relevant documentation
9. summarize changed files
10. identify remaining risks

Do not perform unrelated refactors while implementing a feature.

---

# 59. RESPONSE FORMAT DURING IMPLEMENTATION

When assigned a coding task, respond with:

## Understanding

Briefly state what is being implemented.

## Impacted Areas

List modules/packages affected.

## Approach

Explain implementation approach.

## Risks

Identify major risks/edge cases.

Then implement.

After implementation, report:

## Completed

What was implemented.

## Tests

What was tested.

## Architecture

Confirm whether architectural boundaries changed.

## Remaining

Anything intentionally deferred.

Keep responses concise and engineering-focused.

---

# 60. FINAL PRINCIPLE

GhostShopper should be:

small in features

strong in architecture

reliable in execution

explainable in conclusions

safe in operation

easy to scale

easy to maintain

Do not turn GhostShopper into a giant ecommerce platform.

Build the smallest excellent product that reliably proves:

> A synthetic shopper can continuously detect when a Shopify purchasing experience breaks or deteriorates.

That is GhostShopper V1.