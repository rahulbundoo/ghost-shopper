import { describe, expect, it, vi } from 'vitest';
import type { Route } from 'playwright';
import { respondSafely } from '../../packages/browser/src/transport.js';

function fixture(path = '/products/shirt') {
  const response = {
    status: () => 200,
    headers: () => ({
      'content-type': 'text/html',
      'content-encoding': 'gzip',
      'content-length': '7',
    }),
    body: () => Promise.resolve(Buffer.from('decoded')),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const fetch = vi.fn().mockResolvedValue(response);
  const fulfill = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  const route = {
    request: () => ({
      url: () => `https://shop.example${path}`,
      method: () => 'GET',
      isNavigationRequest: () => true,
    }),
    fetch,
    fulfill,
    abort,
  } as unknown as Route;
  return { route, response, fetch, fulfill, abort };
}
describe('browser no-follow transport', () => {
  it('disables automatic redirects/retries, releases response buffers and removes compression headers', async () => {
    const f = fixture();
    await respondSafely(f.route, 'https://shop.example', false);
    expect(f.fetch).toHaveBeenCalledWith({ maxRedirects: 0, maxRetries: 0, timeout: 10000 });
    expect(f.response.dispose).toHaveBeenCalledOnce();
    expect(f.fulfill).toHaveBeenCalledWith({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: Buffer.from('decoded'),
    });
  });
  it('discards all checkout content and response headers before fulfillment', async () => {
    const f = fixture('/checkouts/private-token');
    await respondSafely(f.route, 'https://shop.example', true);
    expect(f.fulfill).toHaveBeenCalledWith({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Checkout initiated</title>',
    });
  });
  it('does not fulfill oversized upstream responses and still disposes them', async () => {
    const f = fixture();
    f.response.body = () => Promise.resolve(Buffer.alloc(10_000_001));
    await expect(respondSafely(f.route, 'https://shop.example', false)).rejects.toThrow(
      'RESPONSE_TOO_LARGE',
    );
    expect(f.response.dispose).toHaveBeenCalledOnce();
    expect(f.fulfill).not.toHaveBeenCalled();
  });
});
