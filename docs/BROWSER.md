# Browser journey engine (Phase 4)

The runner executes PURCHASE_JOURNEY with Playwright 1.63.0. Web never launches a browser. The engine emits seven ordered ActionResult records and persists each through the active run lease. A storefront failure returns a failed step and remaining steps SKIPPED; browser startup or infrastructure failure returns ERROR. Phase 5 captures evidence, Phase 6 adds deterministic findings, and Phase 7 reconciles incidents at run completion. No AI is implemented; incident persistence remains outside the browser package.

## Docker-free local use

Use your installed Chrome by setting `BROWSER_CHANNEL=chrome` in root `.env` (as shown in `.env.example`). `msedge` is also supported. No browser download is needed for these channels. Set native/remote DATABASE_URL and REDIS_URL, apply all migrations with `pnpm db:migrate`, then start `pnpm dev:runner` and the web application separately. See [runner setup](RUNNER.md).

`BROWSER_CHANNEL=chromium` (the production/CI default) uses Playwright's headless Chromium shell. Install only that binary with `pnpm browser:install` if needed; do not run it on a space-constrained laptop that already has Chrome. Linux needs Chromium system dependencies and a working sandbox. The optional CI runner image installs the headless shell; local development does not build or run that image. Never disable Chromium's sandbox to work around deployment configuration.

`ACTION_TIMEOUT_MS` bounds each complete action, including product discovery (default 10000; 1000–30000). `RUN_TIMEOUT_MS` bounds the run (default 120000; maximum 300000). Abort, action timeout and lease rejection close the isolated browser context. Each run also gets a separate browser process and authenticated loopback proxy, all closed in finally blocks. Start with low RUNNER_CONCURRENCY on a laptop.

Run the controlled browser suite with `pnpm test:browser`. It reads BROWSER_CHANNEL from root `.env`; in PowerShell without an `.env`, use `$env:BROWSER_CHANNEL='chrome'` before running it. Fixtures replace upstream responses, not the journey, routing, redirects, locators or browser. No external storefront, PostgreSQL or Redis is contacted by this suite.

## Actions and locator support

1. OPEN_HOME: load the shop's server-synchronized HTTPS primary domain, discover its locale root, and verify a fresh empty cart.
2. FIND_PRODUCT: inspect product links on home and at most three `/collections/all` pages; inspect at most 60 unique public product JSON endpoints. Match the exact configured Shopify Product GID. Failure within this limit is explicit, not proof that the product is absent from the entire catalog.
3. OPEN_PRODUCT: load its canonical product page and revalidate product identity.
4. SELECT_VARIANT: select the configured variant, or first available variant when none is configured. Use a visible variant select, option-labelled dropdowns or radio groups; verify the actual add-to-cart form's variant ID. Sold-out and unknown variants fail without cart mutation.
5. ADD_TO_CART: click the resolved button once, require a successful cart-add response, then require exactly one item with the selected product/variant and quantity one.
6. OPEN_CART: load the cart page, recheck its contents and resolve its checkout control.
7. BEGIN_CHECKOUT: click the checkout control and require a successful same-store `/checkouts/<token>` document response. The document is replaced with an inert page before its scripts or payment controls render. No subsequent journey action exists.

LocatorResolver orders accessible role/name strategies before Shopify form semantics. Ambiguous visible controls fail closed. It never force-clicks, edits hidden variant inputs, bypasses add-to-cart with an API write, solves challenges, or uses AI to choose controls. Public JSON reads only validate identity/cart state. Product/variant IDs still need to be supplied through the authenticated monitor API; no new Admin scopes were added.

## Network and purchase safety

The browser context blocks service workers, WebSockets, downloads, permissions, popups and subframe navigation. Network destinations are limited to the synchronized storefront origin plus `cdn.shopify.com` and `fonts.shopifycdn.com`. Navigation remains on the exact storefront origin. All traffic uses an authenticated, per-run local CONNECT proxy. The proxy accepts only allowlisted DNS names on port 443, resolves IPv4 addresses, rejects private/reserved answers and connects to the validated numeric address. This prevents browser DNS re-resolution/rebinding; IPv6-only destinations currently fail closed. TLS verification remains enabled.

Playwright does not re-intercept automatic redirect hops. The transport therefore fetches with `maxRedirects: 0`, validates each document redirect and generates a fresh GET navigation. Non-document redirects, cross-origin redirects and POST-preserving redirects are rejected. Response bodies are size-checked after buffering; stream-level byte/memory quotas remain hardening work. Required blocked navigation fails the journey rather than reporting success.

Only one quantity-one cart-add POST for the verified variant, and the checkout-initiation cart form POST, are allowed. Other writes are blocked. Checkout URLs/tokens and query strings are not persisted. Error messages are fixed strings, not raw browser errors or merchant HTML. No checkout form fields are filled. A passed result means checkout initiation only, not payment processing or successful order placement.

## Limits and acceptance

This intentionally conservative implementation is not broad theme certification: accelerated/cross-domain checkout, headless stores, password/CAPTCHA challenges, third-party essential scripts, ambiguous duplicate purchase controls, non-English controls without Shopify form semantics, unusual variant widgets and large/deep catalogs can fail. Custom domains must already be synchronized from authenticated Shopify GraphQL. Multi-currency/localization and high-variant themes need real-store compatibility work; the runner will not substitute another product.

Before claiming Shopify acceptance, use an authorized public development storefront and native/remote PostgreSQL/Redis. Create desktop and mobile monitors for a known available product/variant, POST a run, and verify seven steps via GET `/app/api/runs/:runId`. Repeat with sold-out/invalid variants and broken cart controls. Verify no orders were created. The local controlled browser suite does not prove real-store acceptance or deployed sandbox/network isolation.

Phase 5 collects masked per-step PNGs, operation-only trace ZIPs and bounded console/network/metadata JSON through a runner-provided sink. Capture/upload failures downgrade otherwise passing journeys to WARNING. New requests are blocked during final evidence flush and abort cleanup. Phase 6 consumes these exports for [deterministic findings](ANALYSIS.md); ANALYZING does not imply AI. Late diagnostic events retain the last executed step rather than being attributed to skipped actions. Timeout or process loss can leave partial history; each attempt remains separately indexed. Lease fencing protects persisted state, not exactly-once external effects after a paused process. See [evidence privacy, limits and setup](EVIDENCE.md); real-store acceptance also requires private S3 storage.
