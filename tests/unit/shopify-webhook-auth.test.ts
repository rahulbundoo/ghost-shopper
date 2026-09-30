import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SessionStorage } from '../../packages/shopify/src/index.js';
import { createShopifyApplication } from '../../packages/shopify/src/app.js';

const config = {
  apiKey: 'test-client-id',
  apiSecretKey: 'test-webhook-secret',
  appUrl: 'https://ghostshopper.example',
  databaseUrl: 'postgresql://unused',
};
function app() {
  const storage = {
    storeSession: vi.fn().mockResolvedValue(true),
    loadSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(true),
    deleteSessions: vi.fn().mockResolvedValue(true),
    findSessionsByShop: vi.fn().mockResolvedValue([]),
  } satisfies SessionStorage;
  const shopify = createShopifyApplication(config, storage, { markInstalled: vi.fn() });
  return { shopify, storage };
}
function webhook(hmac: string, body = '{"id":123}') {
  return new Request(config.appUrl + '/webhooks/app/uninstalled', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-shopify-topic': 'app/uninstalled',
      'x-shopify-shop-domain': 'demo.myshopify.com',
      'x-shopify-api-version': '2026-07',
      'x-shopify-webhook-id': 'test-webhook-id',
      'x-shopify-hmac-sha256': hmac,
    },
  });
}
describe('official Shopify webhook authentication', () => {
  it('rejects an invalid signature before accessing session storage', async () => {
    const { shopify, storage } = app();
    await expect(shopify.authenticate.webhook(webhook('invalid'))).rejects.toMatchObject({
      status: 401,
    });
    expect(storage.loadSession).not.toHaveBeenCalled();
  });
  it('accepts a signed uninstall even when the app session is already gone', async () => {
    const { shopify } = app();
    const hmac = createHmac('sha256', config.apiSecretKey).update('{"id":123}').digest('base64');
    const result = await shopify.authenticate.webhook(webhook(hmac));
    expect(result.shop).toBe('demo.myshopify.com');
    expect(result.topic).toBe('APP_UNINSTALLED');
  });
  it('rejects tampering with a previously signed body', async () => {
    const { shopify } = app();
    const hmac = createHmac('sha256', config.apiSecretKey).update('{"id":123}').digest('base64');
    await expect(shopify.authenticate.webhook(webhook(hmac, '{"id":456}'))).rejects.toMatchObject({
      status: 401,
    });
  });
});
