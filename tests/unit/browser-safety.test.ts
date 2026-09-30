import { describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { resolve4 } from 'node:dns/promises';
import {
  isPublicIPv4,
  safeResultUrl,
  startEgressProxy,
  storefrontOrigin,
} from '../../packages/browser/src/safety.js';
import { actionResultSchema } from '../../packages/contracts/src/index.js';
vi.mock('node:dns/promises', () => ({ resolve4: vi.fn() }));

describe('runner destination safety', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'not-an-ip',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicIPv4(address)).toBe(false);
  });
  it.each(['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1'])(
    'accepts public IPv4 %s',
    (address) => {
      expect(isPublicIPv4(address)).toBe(true);
    },
  );
  it.each([
    'http://shop.example',
    'https://127.0.0.1',
    'https://[::1]',
    'https://shop.example:8443',
    'https://user:secret@shop.example',
    'file:///secret',
    'https://shop.example/path',
    'https://shop.example?secret',
  ])('rejects unsafe target %s', (url) => {
    expect(() => storefrontOrigin(url)).toThrow();
  });
  it('redacts query strings, checkout tokens, unknown paths and credentials', () => {
    expect(safeResultUrl('https://shop.example/products/shirt?token=secret#private')).toBe(
      'https://shop.example/products/shirt',
    );
    expect(safeResultUrl('https://shop.example/checkouts/secret?key=private')).toBe(
      'https://shop.example/checkout',
    );
    expect(safeResultUrl('https://shop.example/private-token')).toBe('https://shop.example');
    expect(safeResultUrl('https://user:secret@shop.example')).toBeNull();
  });
  it('denies proxy hosts outside the allowlist and private DNS results', async () => {
    vi.mocked(resolve4).mockResolvedValue(['127.0.0.1']);
    const proxy = await startEgressProxy(new Set(['shop.example']));
    const connect = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(proxy.settings.server, {
          method: 'CONNECT',
          path: `${host}:443`,
          headers: {
            'proxy-authorization': `Basic ${Buffer.from(`runner:${proxy.settings.password}`).toString('base64')}`,
          },
        });
        req.on('connect', (response, socket) => {
          socket.destroy();
          resolve(response.statusCode ?? 0);
        });
        req.on('error', (error: NodeJS.ErrnoException) =>
          error.code === 'ECONNRESET' ? resolve(0) : reject(error),
        );
        req.end();
      });
    try {
      expect(await connect('other.example')).toBe(403);
      expect(await connect('shop.example')).toBe(0);
      expect(resolve4).toHaveBeenCalledWith('shop.example');
    } finally {
      await proxy.close();
    }
  });
});
describe('structured step contract', () => {
  const valid = {
    action: 'OPEN_HOME',
    position: 0,
    status: 'PASSED',
    startedAt: new Date(0),
    finishedAt: new Date(5),
    durationMs: 5,
    currentUrl: 'https://shop.example/',
    errorCode: null,
    errorMessage: null,
  };
  it('validates ordering, timing, outcomes and safe URLs', () => {
    expect(actionResultSchema.safeParse(valid).success).toBe(true);
    for (const change of [
      { position: 1 },
      { durationMs: 4 },
      { status: 'FAILED' },
      { currentUrl: 'https://shop.example/?secret' },
      { errorCode: 'ARBITRARY' },
    ])
      expect(actionResultSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
