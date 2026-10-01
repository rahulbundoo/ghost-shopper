import {
  chromium,
  devices,
  errors,
  type Browser,
  type BrowserContext,
  type Request,
} from 'playwright';
import type { ActionResult, TestRun, StepErrorCode } from '@ghostshopper/domain';
import { ActionFailure, purchaseJourney, type JourneyContext } from './actions.js';
import { LocatorResolver } from './locators.js';
import { safeResultUrl, startEgressProxy, storefrontOrigin } from './safety.js';
import { respondSafely, type FixtureTransport } from './transport.js';
import { EvidenceCollector, type EvidenceSink } from './evidence.js';

export interface BrowserEngineOptions {
  channel?: 'chrome' | 'msedge' | 'chromium';
  actionTimeoutMs?: number;
  traceEnabled?: boolean;
  /** Injection is for controlled browser fixtures; production always launches Chromium. */
  launch?: typeof chromium.launch;
  fixtureTransport?: FixtureTransport;
}
export class BrowserExecutionError extends Error {
  constructor(
    readonly code: 'BROWSER_UNAVAILABLE' | 'LEASE_LOST' | 'RUN_ABORTED',
    options?: ErrorOptions,
  ) {
    super(code, options);
  }
}
const messages: Record<StepErrorCode, string> = {
  PAGE_UNAVAILABLE: 'The storefront page could not be loaded.',
  PRODUCT_NOT_FOUND: 'The configured product was not found within the discovery limit.',
  VARIANT_UNAVAILABLE: 'The requested variant is unavailable.',
  VARIANT_SELECTOR_FAILURE: 'The requested variant could not be selected unambiguously.',
  ADD_TO_CART_FAILURE: 'Adding the selected item to the cart failed.',
  CART_FAILURE: 'The cart did not contain exactly the selected item.',
  CHECKOUT_FAILURE: 'Checkout initiation could not be confirmed.',
  ACTION_TIMEOUT: 'The storefront action exceeded its time limit.',
  UNSAFE_NAVIGATION: 'A required navigation was blocked by the safety policy.',
  RUN_ABORTED: 'The run was cancelled or timed out.',
  PREVIOUS_STEP_FAILED: 'Skipped because an earlier step failed.',
};
function cartAdditionMatches(request: Request, id: string): boolean {
  const raw = request.postData() ?? '';
  if (raw.length > 64_000) return false;
  const contentType = request.headers()['content-type'] ?? '';
  try {
    if (contentType.includes('application/json')) {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      const data = parsed as Record<string, unknown>;
      const items = data['items'];
      const item = Array.isArray(items)
        ? items.length === 1
          ? (items[0] as unknown)
          : null
        : data;
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return String(record['id']) === id && Number(record['quantity'] ?? 1) === 1;
    }
    if (contentType.includes('multipart/form-data')) {
      const ids = [...raw.matchAll(/name="id"\r\n\r\n([^\r\n]+)/g)];
      const quantities = [...raw.matchAll(/name="quantity"\r\n\r\n([^\r\n]+)/g)];
      return (
        ids.length === 1 &&
        ids[0]?.[1] === id &&
        quantities.length <= 1 &&
        Number(quantities[0]?.[1] ?? 1) === 1
      );
    }
    const data = new URLSearchParams(raw);
    return (
      data.getAll('id').length === 1 &&
      data.get('id') === id &&
      data.getAll('quantity').length <= 1 &&
      Number(data.get('quantity') ?? 1) === 1
    );
  } catch {
    return false;
  }
}
export class PlaywrightJourneyEngine {
  constructor(private readonly options: BrowserEngineOptions = {}) {}

  async execute(
    run: TestRun,
    target: string,
    signal: AbortSignal,
    recordStep: (result: ActionResult) => Promise<boolean>,
    evidenceSink?: EvidenceSink,
  ): Promise<'PASSED' | 'WARNING' | 'FAILED'> {
    const origin = storefrontOrigin(target);
    const hosts = new Set([new URL(origin).hostname, 'cdn.shopify.com', 'fonts.shopifycdn.com']);
    const proxy = await startEgressProxy(hosts);
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let cleanupFailure = false;
    const evidence = evidenceSink
      ? new EvidenceCollector(evidenceSink, this.options.traceEnabled ?? true)
      : undefined;
    let aborted = false;
    let collecting = false;
    let abortTask: Promise<void> | undefined;
    const abort = () => {
      aborted = true;
      abortTask ??= (async () => {
        await evidence?.interrupt();
        await context?.close();
      })().catch(() => {
        cleanupFailure = true;
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) throw new BrowserExecutionError('RUN_ABORTED');
      try {
        browser = await (this.options.launch ?? chromium.launch)({
          headless: true,
          ...(this.options.channel && this.options.channel !== 'chromium'
            ? { channel: this.options.channel }
            : {}),
          chromiumSandbox: true,
          args: [
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
            '--disable-background-networking',
          ],
        });
      } catch (cause) {
        throw new BrowserExecutionError('BROWSER_UNAVAILABLE', { cause });
      }
      if (signal.aborted) throw new BrowserExecutionError('RUN_ABORTED');
      context = await browser.newContext({
        ...(run.device === 'MOBILE' ? devices['Pixel 7'] : devices['Desktop Chrome']),
        viewport:
          run.device === 'MOBILE' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        serviceWorkers: 'block',
        acceptDownloads: false,
        permissions: [],
        proxy: proxy.settings,
      });
      const timeout = this.options.actionTimeoutMs ?? 10_000;
      context.setDefaultTimeout(timeout);
      context.setDefaultNavigationTimeout(timeout);
      await context.routeWebSocket('**/*', (socket) => socket.close());
      const page = await context.newPage();
      await evidence?.start(context, page);
      page.on('dialog', (dialog) => {
        void dialog.dismiss().catch(() => {
          cleanupFailure = true;
        });
      });
      context.on('page', (popup) => {
        if (popup !== page)
          void popup.close().catch(() => {
            cleanupFailure = true;
          });
      });
      const state: JourneyContext = {
        page,
        run,
        origin,
        root: '/',
        resolver: new LocatorResolver(),
        checkoutStarted: false,
      };
      let activeAction = '';
      let unsafeNavigation = false;
      let documentStatus = 0;
      let cartWriteCount = 0;
      page.on('response', (response) => {
        if (response.request().isNavigationRequest() && response.frame() === page.mainFrame())
          documentStatus = response.status();
      });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        const navigation = request.isNavigationRequest();
        const sameOrigin = url.origin === origin;
        const checkout = /\/checkouts?(?:\/|$)/i.test(url.pathname);
        let allowed =
          !aborted &&
          !collecting &&
          url.protocol === 'https:' &&
          !url.port &&
          !url.username &&
          !url.password &&
          hosts.has(url.hostname);
        if (navigation) allowed &&= sameOrigin && request.frame() === page.mainFrame();
        if (checkout)
          allowed &&= sameOrigin && state.checkoutStarted && method === 'GET' && navigation;
        if (method !== 'GET' && method !== 'HEAD') {
          const add =
            sameOrigin &&
            method === 'POST' &&
            activeAction === 'ADD_TO_CART' &&
            /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?cart\/add(?:\.js)?$/.test(url.pathname) &&
            Boolean(state.variant && cartAdditionMatches(request, state.variant.id)) &&
            cartWriteCount === 0;
          const checkoutPost =
            sameOrigin &&
            method === 'POST' &&
            state.checkoutStarted &&
            url.pathname === `${state.root}cart` &&
            new URLSearchParams(request.postData() ?? '').has('checkout');
          allowed &&= add || checkoutPost;
          if (allowed && add) cartWriteCount++;
        }
        // No writes, iframe navigation or third-party requests at checkout.
        if (state.checkoutStarted && !sameOrigin) allowed = false;
        if (!allowed) {
          if (navigation) unsafeNavigation = true;
          await route.abort('blockedbyclient');
        } else {
          try {
            await respondSafely(
              route,
              origin,
              state.checkoutStarted,
              this.options.fixtureTransport,
            );
          } catch {
            await route.abort('failed').catch(() => {
              cleanupFailure = true;
            });
          }
        }
      });
      let failed = false;
      for (const [position, action] of purchaseJourney.entries()) {
        if (!failed) evidence?.begin(position);
        const startedAt = new Date();
        let code: StepErrorCode | null = failed ? 'PREVIOUS_STEP_FAILED' : null;
        if (!failed) {
          activeAction = action.name;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            if (signal.aborted) throw new ActionFailure('RUN_ABORTED');
            await Promise.race([
              action.execute(state),
              new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                  reject(new ActionFailure('ACTION_TIMEOUT'));
                  abort();
                }, timeout);
              }),
            ]);
            if (unsafeNavigation) throw new ActionFailure('UNSAFE_NAVIGATION');
            if (action.name === 'BEGIN_CHECKOUT' && (documentStatus < 200 || documentStatus >= 400))
              throw new ActionFailure('CHECKOUT_FAILURE');
          } catch (error) {
            code = signal.aborted
              ? 'RUN_ABORTED'
              : unsafeNavigation
                ? 'UNSAFE_NAVIGATION'
                : error instanceof ActionFailure
                  ? error.code
                  : error instanceof errors.TimeoutError
                    ? 'ACTION_TIMEOUT'
                    : action.failureCode;
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
        const finishedAt = new Date();
        const step: ActionResult = {
          action: action.name,
          position,
          status: failed ? 'SKIPPED' : code ? 'FAILED' : 'PASSED',
          startedAt,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          currentUrl: safeResultUrl(page.url()),
          errorCode: code,
          errorMessage: code ? messages[code] : null,
        };
        if (!(await recordStep(step))) throw new BrowserExecutionError('LEASE_LOST');
        await evidence?.afterStep(step);
        if (code) failed = true;
      }
      collecting = true;
      await abortTask;
      await evidence?.finish();
      return failed ? 'FAILED' : evidence?.incomplete ? 'WARNING' : 'PASSED';
    } finally {
      signal.removeEventListener('abort', abort);
      collecting = true;
      try {
        await abortTask;
        await evidence?.finish();
      } finally {
        try {
          await context?.close();
        } catch {
          cleanupFailure = true;
        }
        try {
          await browser?.close();
        } finally {
          await proxy.close();
        }
      }
      if (cleanupFailure && !browser?.isConnected()) cleanupFailure = false;
      if (cleanupFailure) await Promise.reject(new Error('BROWSER_CLEANUP_FAILED'));
    }
  }
}
