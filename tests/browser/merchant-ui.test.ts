import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

let server: ChildProcess;
let browser: Browser;
const base = 'http://127.0.0.1:4180';
const monitorId = '0246091e-d6bc-42b8-a31a-ea073bb7b360';
const runId = '57e735d9-220b-4be1-8fda-fda1c7a71ab5';
beforeAll(async () => {
  server = spawn(
    process.execPath,
    [
      'apps/web/node_modules/vite/bin/vite.js',
      '--config',
      'apps/web/ui-fixture/vite.config.ts',
      '--port',
      '4180',
    ],
    { windowsHide: true, stdio: 'pipe' },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('UI fixture startup timed out')), 20000);
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('UI fixture exited'));
    });
    server.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('127.0.0.1:4180')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
  });
});
afterAll(async () => {
  await browser?.close();
  server?.kill();
});
async function page() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  // Keep repeatable interaction tests offline. Live Polaris rendering is checked separately in Chrome.
  await page.route('https://cdn.shopify.com/**', (route) => route.abort());
  return page;
}
describe('merchant screens using synthetic data and real React components', () => {
  it('requires email opt-in and submits recovery preference without sending a test message', async () => {
    const view = await page();
    const bodies: unknown[] = [];
    await view.route('**/app/api/notifications', async (route) => {
      bodies.push(route.request().postDataJSON() as unknown);
      await route.fulfill({ json: { settings: { version: 1 } } });
    });
    try {
      await view.goto(`${base}/app/settings`);
      expect(await view.getByLabel('I authorize alerts to this email address').isChecked()).toBe(
        false,
      );
      await view.getByRole('button', { name: 'Save notifications' }).click();
      expect(bodies).toHaveLength(0);
      await view.getByLabel('Notification email').fill('owner@example.com');
      await view.getByLabel('I authorize alerts to this email address').check();
      await view
        .getByLabel('Send recovery notifications after an alerted journey recovers')
        .uncheck();
      await Promise.all([
        view.waitForResponse('**/app/api/notifications'),
        view.getByRole('button', { name: 'Save notifications' }).click(),
      ]);
      expect(bodies).toEqual([
        { email: 'owner@example.com', enabled: true, recoveryEnabled: false, version: 0 },
      ]);
    } finally {
      await view.close();
    }
  });
  it('shows failed and missing device coverage honestly on mobile', async () => {
    const view = await page();
    try {
      await view.goto(`${base}/app`);
      await view.getByRole('heading', { name: 'Latest journey needs attention' }).waitFor();
      expect(await view.getByText('No desktop check in the latest 25 runs.').count()).toBe(1);
      expect(await view.getByText('Add to cart failed', { exact: true }).count()).toBe(1);
      expect(
        await view.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    } finally {
      await view.close();
    }
  });
  it('validates input then submits one create request and navigates to saved monitor', async () => {
    const view = await page();
    const bodies: unknown[] = [];
    await view.route('**/app/api/monitors', async (route) => {
      bodies.push(route.request().postDataJSON() as unknown);
      await route.fulfill({ json: { monitor: { id: monitorId } } });
    });
    try {
      await view.goto(`${base}/app/monitors/new`);
      await view.getByRole('button', { name: 'Save monitor' }).click();
      expect(bodies).toHaveLength(0);
      await view.getByLabel('Monitor name').fill('Mobile shirt');
      await view.getByLabel('Shopify product ID').fill('gid://shopify/Product/42');
      await view.getByLabel('Device', { exact: true }).selectOption('MOBILE');
      await view.getByRole('button', { name: 'Save monitor' }).click();
      await view.waitForURL(`${base}/app/monitors/${monitorId}`);
      expect(bodies).toEqual([
        {
          name: 'Mobile shirt',
          productId: 'gid://shopify/Product/42',
          variantId: null,
          scenario: 'PURCHASE_JOURNEY',
          device: 'MOBILE',
          frequency: 'DAILY',
          enabled: true,
        },
      ]);
    } finally {
      await view.close();
    }
  });
  it('preserves edits on a conflict and sends version plus disabled state without retry', async () => {
    const view = await page();
    const bodies: unknown[] = [];
    await view.route('**/app/api/monitors/*', async (route) => {
      bodies.push(route.request().postDataJSON() as unknown);
      await route.fulfill({ status: 409, json: { error: { code: 'CONFLICT' } } });
    });
    try {
      await view.goto(`${base}/app/monitors/${monitorId}`);
      await view.getByLabel('Monitor name').fill('Unsaved name');
      await view.getByLabel('Enabled (allows manual checks)').uncheck();
      await view.getByRole('button', { name: 'Save monitor' }).click();
      await view.getByRole('alert').waitFor();
      expect(await view.getByRole('alert').innerText()).toContain('Reload');
      expect(await view.getByLabel('Monitor name').inputValue()).toBe('Unsaved name');
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({ version: 1, enabled: false });
    } finally {
      await view.close();
    }
  });
  it('isolates attempt evidence and handles expired evidence access', async () => {
    const view = await page();
    let downloads = 0;
    await view.route('**/app/api/artifacts/*/download', async (route) => {
      downloads++;
      await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
    });
    try {
      await view.goto(`${base}/app/runs/${runId}`);
      await view.getByText('Technical score: 0/100', { exact: true }).waitFor();
      expect(downloads).toBe(0);
      expect(
        await view
          .getByText('AI ANALYSIS · Interpretation, not detected fact', { exact: true })
          .count(),
      ).toBe(1);
      await view.getByLabel('Attempt', { exact: true }).selectOption('1');
      expect(
        await view.getByText('No recorded steps for this attempt yet.', { exact: true }).count(),
      ).toBe(1);
      expect(await view.getByText('Technical score: 0/100', { exact: true }).count()).toBe(0);
      await view.getByLabel('Attempt', { exact: true }).selectOption('2');
      await view.locator('s-button').filter({ hasText: 'Open evidence' }).click();
      await view.getByRole('alert').waitFor();
      expect(await view.getByRole('alert').innerText()).toContain('expired');
      expect(downloads).toBe(1);
    } finally {
      await view.close();
    }
  });
  it('requests a run through the API and navigates without invoking a browser engine', async () => {
    const view = await page();
    const bodies: unknown[] = [];
    await view.route('**/app/api/runs', async (route) => {
      bodies.push(route.request().postDataJSON() as unknown);
      await route.fulfill({
        status: 202,
        json: { run: { id: runId }, dispatch: 'DISPATCH_PENDING' },
      });
    });
    try {
      await view.goto(`${base}/app/monitors/${monitorId}`);
      await view.locator('s-button').filter({ hasText: 'Run now' }).click();
      await view.waitForURL(`${base}/app/runs/${runId}`);
      expect(bodies).toEqual([{ monitorId }]);
    } finally {
      await view.close();
    }
  });
  it('shows allowance exhaustion and requires an explicit Shopify approval link', async () => {
    const view = await page();
    const bodies: unknown[] = [];
    await view.route('**/app/api/billing', async (route) => {
      bodies.push(route.request().postDataJSON() as unknown);
      await route.fulfill({
        json: { confirmationUrl: 'https://admin.shopify.com/confirm-fixture' },
      });
    });
    try {
      await view.goto(`${base}/app/billing`);
      await view.getByText('100 / 100 runs in the current allowance.').waitFor();
      expect(bodies).toHaveLength(0);
      await view.getByRole('button', { name: 'Review paid plan on Shopify' }).click();
      const link = view.getByRole('link', { name: 'Continue to Shopify approval' });
      await link.waitFor();
      expect(await link.getAttribute('target')).toBe('_top');
      expect(bodies).toEqual([{ action: 'checkout' }]);
      expect(view.url()).toBe(`${base}/app/billing`);
    } finally {
      await view.close();
    }
  });
  it('requires cancellation acknowledgement and reports billing errors', async () => {
    const view = await page();
    await view.route('**/app/api/billing', (route) =>
      route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE' } } }),
    );
    try {
      await view.goto(`${base}/app/billing-active`);
      const cancel = view.getByRole('button', { name: 'Cancel subscription', exact: true });
      expect(await cancel.isDisabled()).toBe(true);
      await view.getByRole('checkbox').check();
      await cancel.click();
      await view.getByRole('alert').waitFor();
      expect(await view.getByRole('alert').innerText()).toContain('could not be confirmed');
    } finally {
      await view.close();
    }
  });
  it('renders a lazily requested screenshot and removes its short-lived link', async () => {
    const view = await page();
    await view.route('**/app/api/artifacts/*/download', (route) =>
      route.fulfill({
        json: {
          url: `${base}/fixture-evidence.png`,
          expiresAt: new Date(Date.now() + 2500).toISOString(),
        },
      }),
    );
    await view.route('**/fixture-evidence.png', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
          'base64',
        ),
      }),
    );
    try {
      await view.goto(`${base}/app/runs/${runId}`);
      expect(await view.getByRole('img').count()).toBe(0);
      await view.locator('s-button').filter({ hasText: 'Open evidence' }).click();
      await view.getByRole('img', { name: 'Storefront screenshot at step 5' }).waitFor();
      expect(await view.getByRole('img').getAttribute('referrerpolicy')).toBe('no-referrer');
      await view.getByRole('link', { name: 'Download screenshot' }).waitFor({ state: 'detached' });
      expect(await view.getByRole('img').count()).toBe(0);
    } finally {
      await view.close();
    }
  });
});
