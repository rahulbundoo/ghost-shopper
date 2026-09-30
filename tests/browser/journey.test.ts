import { describe, expect, it, vi } from 'vitest';
import {
  PlaywrightJourneyEngine,
  type BrowserEngineOptions,
} from '../../packages/browser/src/index.js';
import { chromium } from 'playwright';
import type { ActionResult, CapturedEvidence, TestRun } from '../../packages/domain/src/index.js';
import { analyzeTechnicalRun } from '../../packages/domain/src/index.js';
import { AnalysisDiagnostics } from '../../apps/runner/src/diagnostics.js';
import type { FixtureTransport, ResponseData } from '../../packages/browser/src/transport.js';

const run: TestRun = {
  id: '57e735d9-220b-4be1-8fda-fda1c7a71ab5',
  shopId: 'fixture.myshopify.com',
  monitorId: '0246091e-d6bc-42b8-a31a-ea073bb7b360',
  monitorVersion: 1,
  scenario: 'PURCHASE_JOURNEY',
  device: 'DESKTOP',
  productId: 'gid://shopify/Product/1',
  variantId: 'gid://shopify/ProductVariant/12',
  status: 'RUNNING',
  outcome: null,
  createdAt: new Date(),
  startedAt: new Date(),
  finishedAt: null,
  attemptCount: 1,
  errorCode: null,
};
type FixtureMode =
  | 'select'
  | 'radio'
  | 'sold-out'
  | 'missing-product'
  | 'cart-error'
  | 'wrong-cart'
  | 'checkout-error'
  | 'unsafe'
  | 'unsafe-redirect'
  | 'post-redirect'
  | 'ambiguous'
  | 'timeout';

function fixture(mode: FixtureMode = 'select') {
  const requests: string[] = [];
  const initialStorage: unknown[] = [];
  const contexts: { closed: boolean; mobile: boolean }[] = [];
  const launch: NonNullable<BrowserEngineOptions['launch']> = async (options) => {
    const browser = await chromium.launch(options);
    const original = browser.newContext.bind(browser);
    vi.spyOn(browser, 'newContext').mockImplementation(async (settings) => {
      const context = await original(settings);
      initialStorage.push(await context.storageState());
      const state = { closed: false, mobile: settings?.isMobile ?? false };
      contexts.push(state);
      context.on('close', () => {
        state.closed = true;
      });
      return context;
    });
    return browser;
  };
  let cart: { variant_id: number; product_id: number; quantity: number }[] = [];
  // Production safety/redirect logic still runs; only upstream responses are replaced.
  const fixtureTransport: FixtureTransport = (request) => {
    const result = (): ResponseData => {
      const url = new URL(request.url());
      const path = url.pathname;
      requests.push(`${request.method()} ${path}`);
      const json = (body: unknown, status = 200) => ({
        status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const html = (body: string, status = 200) => ({
        status,
        headers: { 'content-type': 'text/html' },
        body: `<!doctype html><html><head><title>Fixture</title></head><body>${body}</body></html>`,
      });
      if (path === '/' || path === '/collections/all') {
        if (path === '/') cart = [];
        return html(
          `<script>window.Shopify={routes:{root:'/'}};localStorage.setItem('fixture','set');document.cookie='fixture=set';console.warn('secret-console-token');setTimeout(()=>{throw new Error('secret-exception-token')},0);fetch('http://127.0.0.1:9/private?token=secret').catch(()=>{});</script><a href='/products/shirt'>Shirt</a>`,
        );
      }
      if (path === '/cart.js')
        return json({
          item_count: cart.reduce((sum, item) => sum + item.quantity, 0),
          items: cart,
        });
      if (path === '/products/shirt.js')
        return json({
          id: mode === 'missing-product' ? 2 : 1,
          handle: 'shirt',
          options: ['Size'],
          variants: [
            { id: 11, available: true, options: ['Small'] },
            { id: 12, available: mode !== 'sold-out', options: ['Large'] },
          ],
        });
      if (path === '/products/shirt') {
        const variants =
          mode === 'radio'
            ? `<fieldset><legend>Size</legend><label><input type='radio' name='size' value='11' checked>Small</label><label><input type='radio' name='size' value='12'>Large</label></fieldset><input type='hidden' name='id' value='11'><script>document.querySelectorAll('[name=size]').forEach(el=>el.onchange=()=>document.querySelector('[name=id]').value=el.value)</script>`
            : `<label>Size<select name='id'><option value='11'>Small</option><option value='12'>Large</option></select></label>`;
        return html(
          `<form action='/cart/add' method='post'>${variants}<input name='quantity' value='1' type='hidden'><button name='add'>Add to cart</button></form><script>document.querySelector('form').onsubmit=async(e)=>{e.preventDefault();await fetch('/cart/add.js',{method:'POST',body:new URLSearchParams(new FormData(e.target))})}</script>`,
        );
      }
      if (path === '/cart/add.js') {
        if (mode === 'cart-error') return json({ error: 'Fixture failure' }, 422);
        if (mode === 'timeout') throw new Error('Fixture timeout');
        const id = Number(new URLSearchParams(request.postData() ?? '').get('id'));
        cart = [{ variant_id: mode === 'wrong-cart' ? 99 : id, product_id: 1, quantity: 1 }];
        return json({ id });
      }
      if (path === '/cart' && request.method() === 'POST')
        return {
          status: mode === 'post-redirect' ? 307 : 302,
          headers: {
            location:
              mode === 'unsafe-redirect'
                ? 'http://127.0.0.1:9/private'
                : '/checkouts/fixture-token',
          },
          body: '',
        };
      if (path === '/cart')
        return html(
          mode === 'unsafe'
            ? `<a href='http://127.0.0.1:9/private'>Checkout</a>`
            : `<form action='/cart' method='post'><button name='checkout' value='Checkout'>Checkout</button>${mode === 'ambiguous' ? '<button>Checkout</button>' : ''}</form>`,
        );
      if (path === '/checkouts/fixture-token')
        return html(
          `<h1>Checkout</h1><form action='/payments' method='post'><input name='card'><button>Pay now</button></form><script>fetch('/payments',{method:'POST',body:'forbidden'}).catch(()=>{})</script>`,
          mode === 'checkout-error' ? 500 : 200,
        );
      return html('Not found', 404);
    };
    return Promise.resolve(result());
  };
  const engine = new PlaywrightJourneyEngine({
    launch,
    fixtureTransport,
    channel: process.env.BROWSER_CHANNEL === 'chrome' ? 'chrome' : 'chromium',
    actionTimeoutMs: 3000,
  });
  const steps: ActionResult[] = [];
  return {
    engine,
    requests,
    contexts,
    initialStorage,
    steps,
    execute: (input = run, signal = new AbortController().signal) =>
      engine.execute(input, `https://${run.shopId}`, signal, (step) => {
        steps.push(step);
        return Promise.resolve(true);
      }),
  };
}

describe('isolated Chromium purchase journey', () => {
  it('collects screenshots, a trace and redacted diagnostics for a failed cart', async () => {
    const f = fixture('cart-error');
    const artifacts: CapturedEvidence[] = [];
    const steps: ActionResult[] = [];
    const diagnostics = new AnalysisDiagnostics();
    const result = await f.engine.execute(
      run,
      `https://${run.shopId}`,
      new AbortController().signal,
      (step) => {
        steps.push(step);
        return Promise.resolve(true);
      },
      (artifact) => {
        artifacts.push(artifact);
        diagnostics.capture(artifact);
        return Promise.resolve();
      },
    );
    expect(result).toBe('FAILED');
    expect(artifacts.map((a) => a.type)).toEqual([
      'SCREENSHOT',
      'SCREENSHOT',
      'SCREENSHOT',
      'SCREENSHOT',
      'SCREENSHOT',
      'TRACE',
      'CONSOLE',
      'NETWORK',
      'METADATA',
    ]);
    expect(Buffer.from(artifacts[0]!.body).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(
      Buffer.from(artifacts.find((a) => a.type === 'TRACE')!.body)
        .subarray(0, 2)
        .toString(),
    ).toBe('PK');
    const text = (type: string) =>
      Buffer.from(artifacts.find((a) => a.type === type)!.body).toString();
    expect(text('CONSOLE')).toContain('pageerror');
    expect(text('CONSOLE')).not.toContain('secret-console-token');
    expect(text('CONSOLE')).not.toContain('secret-exception-token');
    expect(text('NETWORK')).toContain('422');
    expect(text('NETWORK')).toContain('REQUEST_FAILED');
    expect(text('NETWORK')).not.toContain('token=');
    expect(text('METADATA')).toContain('ADD_TO_CART_FAILURE');
    const analysis = analyzeTechnicalRun({
      steps,
      diagnostics: diagnostics.events,
      diagnosticsComplete: diagnostics.complete,
      journeyOutcome: result,
    });
    expect(analysis).toMatchObject({ score: 0, outcome: 'FAILED', complete: true });
    expect(
      analysis.findings.some(
        (finding) => finding.type === 'ADD_TO_CART_FAILURE' && finding.severity === 'CRITICAL',
      ),
    ).toBe(true);
    expect(analysis.findings.some((finding) => finding.type === 'JS_ERROR')).toBe(true);
    expect(analysis.findings.some((finding) => finding.type === 'HTTP_ERROR')).toBe(true);
    expect(f.contexts.every((c) => c.closed)).toBe(true);
  });
  it('reports incomplete evidence as WARNING without retrying a successful cart', async () => {
    const f = fixture();
    const result = await f.engine.execute(
      run,
      `https://${run.shopId}`,
      new AbortController().signal,
      () => Promise.resolve(true),
      () => Promise.reject(new Error('private storage credential')),
    );
    expect(result).toBe('WARNING');
    expect(f.requests.filter((r) => r.startsWith('POST /cart/add'))).toHaveLength(1);
    expect(f.contexts.every((c) => c.closed)).toBe(true);
  });
  it('flushes trace and metadata on an action timeout', async () => {
    const f = fixture('timeout');
    const artifacts: CapturedEvidence[] = [];
    expect(
      await f.engine.execute(
        run,
        `https://${run.shopId}`,
        new AbortController().signal,
        () => Promise.resolve(true),
        (artifact) => {
          artifacts.push(artifact);
          return Promise.resolve();
        },
      ),
    ).toBe('FAILED');
    expect(artifacts.some((a) => a.type === 'TRACE')).toBe(true);
    expect(Buffer.from(artifacts.find((a) => a.type === 'METADATA')!.body).toString()).toContain(
      'ACTION_TIMEOUT',
    );
  });
  it.each(['select', 'radio'] as const)(
    'executes seven actions with %s variants and stops before payment',
    async (mode) => {
      const f = fixture(mode);
      const outcome = await f.execute();
      expect(outcome, JSON.stringify(f.steps)).toBe('PASSED');
      expect(f.steps).toHaveLength(7);
      expect(f.steps.every((s) => s.status === 'PASSED')).toBe(true);
      expect(f.steps.at(-1)?.currentUrl).toBe(`https://${run.shopId}/checkout`);
      expect(f.requests).not.toContain('POST /payments');
      expect(f.requests.filter((r) => r.startsWith('POST /cart/add'))).toHaveLength(1);
      expect(f.contexts.every((c) => c.closed)).toBe(true);
    },
  );
  it('uses fresh mobile and desktop contexts for repeated runs', async () => {
    const f = fixture();
    expect(await f.execute()).toBe('PASSED');
    expect(await f.execute({ ...run, device: 'MOBILE' })).toBe('PASSED');
    expect(f.contexts).toEqual([
      { closed: true, mobile: false },
      { closed: true, mobile: true },
    ]);
    expect(f.initialStorage).toEqual([
      { cookies: [], origins: [] },
      { cookies: [], origins: [] },
    ]);
  });
  it.each([
    ['sold-out', 'SELECT_VARIANT', 'VARIANT_UNAVAILABLE'],
    ['missing-product', 'FIND_PRODUCT', 'PRODUCT_NOT_FOUND'],
    ['cart-error', 'ADD_TO_CART', 'ADD_TO_CART_FAILURE'],
    ['wrong-cart', 'ADD_TO_CART', 'CART_FAILURE'],
    ['checkout-error', 'BEGIN_CHECKOUT', 'CHECKOUT_FAILURE'],
    ['unsafe', 'BEGIN_CHECKOUT', 'UNSAFE_NAVIGATION'],
    ['timeout', 'ADD_TO_CART', 'ACTION_TIMEOUT'],
    ['unsafe-redirect', 'BEGIN_CHECKOUT', 'CHECKOUT_FAILURE'],
    ['post-redirect', 'BEGIN_CHECKOUT', 'CHECKOUT_FAILURE'],
    ['ambiguous', 'OPEN_CART', 'CART_FAILURE'],
  ] as const)('reports %s without false success', async (mode, action, code) => {
    const f = fixture(mode);
    expect(await f.execute()).toBe('FAILED');
    expect(f.steps.find((s) => s.status === 'FAILED')).toMatchObject({ action, errorCode: code });
    expect(f.steps).toHaveLength(7);
    expect(f.contexts.every((c) => c.closed)).toBe(true);
  });
  it('closes the context when persistence rejects a stale lease', async () => {
    const f = fixture();
    await expect(
      f.engine.execute(run, `https://${run.shopId}`, new AbortController().signal, () =>
        Promise.resolve(false),
      ),
    ).rejects.toThrow('LEASE_LOST');
    expect(f.requests.some((r) => r.startsWith('POST'))).toBe(false);
    expect(f.contexts.every((c) => c.closed)).toBe(true);
  });
  it('does not launch after cancellation', async () => {
    const f = fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(f.execute(run, abort.signal)).rejects.toThrow('RUN_ABORTED');
    expect(f.contexts).toHaveLength(0);
  });
  it('cancels an active browser before any cart mutation', async () => {
    const f = fixture();
    const abort = new AbortController();
    const steps: ActionResult[] = [];
    expect(
      await f.engine.execute(run, `https://${run.shopId}`, abort.signal, (step) => {
        steps.push(step);
        if (step.action === 'OPEN_HOME') abort.abort();
        return Promise.resolve(true);
      }),
    ).toBe('FAILED');
    expect(steps[1]).toMatchObject({ status: 'FAILED', errorCode: 'RUN_ABORTED' });
    expect(f.requests.some((r) => r.startsWith('POST'))).toBe(false);
    expect(f.contexts.every((c) => c.closed)).toBe(true);
  });
});
