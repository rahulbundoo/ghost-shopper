import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let processUnderTest: ChildProcess | undefined;
let baseUrl: string;
let output = '';
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('No test port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}
beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  processUnderTest = spawn(process.execPath, ['start.mjs'], {
    cwd: resolve('apps/web'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DEPLOYMENT_ENV: 'local',
      HOST: '127.0.0.1',
      PORT: String(port),
      SHOPIFY_API_KEY: 'test-client-id',
      SHOPIFY_API_SECRET: 'test-api-secret',
      SHOPIFY_APP_URL: 'https://ghostshopper.example',
      DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    },
  });
  processUnderTest.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  processUnderTest.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  let startupError: Error | undefined;
  processUnderTest.on('error', (error) => {
    startupError = error;
  });
  for (let attempts = 0; attempts < 80; attempts++) {
    if (startupError) throw startupError;
    if (processUnderTest.exitCode !== null) throw new Error('Web process exited: ' + output);
    try {
      if ((await fetch(baseUrl + '/health')).ok) return;
    } catch {
      /* Await startup. */
    }
    await delay(100);
  }
  throw new Error('Web process did not become healthy: ' + output);
}, 20_000);
afterAll(() => {
  processUnderTest?.kill();
});
describe('production Shopify shell HTTP boundaries', () => {
  it('does not reveal readiness or accept a query-string health credential', async () => {
    const response = await fetch(baseUrl + '/ready?token=forged');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each([
    '/app/settings',
    '/app/billing',
    '/app/monitors',
    '/app/monitors/new',
    '/app/monitors/ce42d97b-795d-42f8-b126-62b00d7c18dd',
    '/app/runs',
    '/app/runs/ce42d97b-795d-42f8-b126-62b00d7c18dd',
    '/app/incidents',
    '/app/incidents/ce42d97b-795d-42f8-b126-62b00d7c18dd',
  ])('protects merchant screen %s with forged credentials', async (path) => {
    const response = await fetch(baseUrl + path + '?shop=other.myshopify.com', {
      redirect: 'manual',
      headers: {
        Authorization: 'Bearer forged-session-token',
        'User-Agent': 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
      },
    });
    expect([302, 400, 401]).toContain(response.status);
    const body = await response.text();
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('test-api-secret');
  });
  it.each([
    '/app/api/notifications',
    '/app/api/billing',
    '/app/api/shop',
    '/app/api/monitors',
    '/app/api/monitors/ce42d97b-795d-42f8-b126-62b00d7c18dd',
    '/app/api/runs',
    '/app/api/incidents',
    '/app/api/incidents/ce42d97b-795d-42f8-b126-62b00d7c18dd',
    '/app/api/runs/ce42d97b-795d-42f8-b126-62b00d7c18dd',
    '/app/api/artifacts/ce42d97b-795d-42f8-b126-62b00d7c18dd/download',
  ])('protects the Phase 2 resource %s without relying on parent authentication', async (path) => {
    const response = await fetch(baseUrl + path + '?shopId=other.myshopify.com');
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED' } });
  });
  it.each(['/app/api/monitors', '/app/api/runs', '/app/api/billing'])(
    'rejects unauthenticated writes to %s',
    async (path) => {
      const response = await fetch(baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"shopId":"other.myshopify.com"}',
      });
      expect(response.status).toBe(401);
    },
  );
  it('rejects forged bearer credentials at the new API boundary', async () => {
    const response = await fetch(baseUrl + '/app/api/monitors', {
      redirect: 'manual',
      headers: {
        Authorization: 'Bearer forged-session-token',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('postgresql://');
  });
  it('serves the public shell without database access or leaked secrets', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('GhostShopper');
    expect(html).toContain('Connect Shopify store');
    expect(html).not.toContain('test-api-secret');
    expect(html).not.toContain('postgresql://');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
  it('rejects an unsigned uninstall webhook', async () => {
    const response = await fetch(baseUrl + '/webhooks/app/uninstalled', {
      method: 'POST',
      body: '{}',
      headers: {
        'content-type': 'application/json',
        'x-shopify-hmac-sha256': 'invalid',
        'x-shopify-topic': 'app/uninstalled',
        'x-shopify-shop-domain': 'demo.myshopify.com',
      },
    });
    expect(response.status).toBe(401);
  });
  it('does not trust a shop query parameter as merchant authentication', async () => {
    const response = await fetch(baseUrl + '/app?shop=other.myshopify.com', {
      redirect: 'manual',
      headers: {
        Authorization: 'Bearer invalid-session-token',
        // Exercise authentication, not Shopify's earlier bot-rejection guard.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    });
    expect([302, 400, 401]).toContain(response.status);
    expect(await response.text()).not.toContain('Your store is connected');
  });
  it('returns a safe missing-page response', async () => {
    const response = await fetch(baseUrl + '/missing-page');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Page not found');
  });
});
