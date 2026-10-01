import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Incident, TestRun } from '../../packages/domain/src/index.js';
import {
  evidenceAvailable,
  merchantApi,
  overviewSummary,
  runSummary,
  timestamp,
} from '../../apps/web/app/merchant-model.js';
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), repositories: vi.fn() }));
vi.mock('../../apps/web/app/hardening.server.js', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../../apps/web/app/shopify.server.js', () => ({
  getRuntime: () => ({ db: {}, shopify: { authenticate: { admin: mocks.authenticate } } }),
  withShopifyBoundary: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@ghostshopper/database', () => ({ createTenantRepositories: mocks.repositories }));
import {
  incidentStatus,
  merchantRead,
  pageQuery,
  pageResult,
  required,
} from '../../apps/web/app/merchant.server.js';
import { DomainError } from '../../packages/domain/src/index.js';
import { ValidationError } from '../../packages/contracts/src/index.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.authenticate.mockReset();
  mocks.repositories.mockReset();
});
describe('merchant UI data boundary', () => {
  it('binds to authenticated session, ignoring spoofed shop parameters', async () => {
    mocks.authenticate.mockResolvedValue({ session: { shop: 'verified.myshopify.com' } });
    mocks.repositories.mockReturnValue({
      shops: { get: () => Promise.resolve({ id: 'verified.myshopify.com' }) },
    });
    expect(
      await merchantRead(
        new Request('https://app.example/app?shop=attacker.myshopify.com'),
        (service) => service.getShop(),
      ),
    ).toMatchObject({
      data: { id: 'verified.myshopify.com' },
      init: { headers: { 'Cache-Control': 'no-store' } },
    });
    expect(mocks.repositories).toHaveBeenCalledWith({}, 'verified.myshopify.com');
  });
  it('does not read data before authentication succeeds', async () => {
    mocks.authenticate.mockRejectedValue(new Response(null, { status: 401 }));
    await expect(
      merchantRead(new Request('https://app.example/app'), vi.fn()),
    ).rejects.toHaveProperty('status', 401);
    expect(mocks.repositories).not.toHaveBeenCalled();
  });
  it.each([
    ['NOT_FOUND', 404],
    ['SHOP_INACTIVE', 403],
    ['CONFLICT', 409],
  ] as const)('maps %s without leaking details', async (code, status) => {
    mocks.authenticate.mockResolvedValue({ session: { shop: 'verified.myshopify.com' } });
    await expect(
      merchantRead(new Request('https://app.example/app'), () =>
        Promise.reject(new DomainError(code)),
      ),
    ).rejects.toHaveProperty('status', status);
  });
  it('maps malformed document filters to 400', async () => {
    mocks.authenticate.mockResolvedValue({ session: { shop: 'verified.myshopify.com' } });
    await expect(
      merchantRead(new Request('https://app.example/app'), () =>
        Promise.reject(new ValidationError(['offset'])),
      ),
    ).rejects.toHaveProperty('status', 400);
  });
  it('accepts embedding parameters without forwarding them as tenant or repository filters', () => {
    expect(
      pageQuery(new Request('https://app.example/app?shop=other&host=encoded&offset=25')),
    ).toEqual({ offset: 25, limit: 26 });
    expect(incidentStatus(new Request('https://app.example/app?status=RESOLVED'))).toBe('RESOLVED');
  });
  it.each(['offset=-1', 'offset=NaN', 'offset=100000', 'offset=1&offset=2'])(
    'rejects invalid pagination: %s',
    (query) => {
      expect(() => pageQuery(new Request(`https://app.example/app?${query}`))).toThrow(
        ValidationError,
      );
    },
  );
  it('rejects unknown or duplicate incident status', () => {
    for (const query of ['status=ALL', 'status=OPEN&status=RESOLVED'])
      expect(() => incidentStatus(new Request(`https://app.example/app?${query}`))).toThrow(
        ValidationError,
      );
  });
  it('uses a lookahead row rather than promising an empty next page', () => {
    expect(
      pageResult(
        Array.from({ length: 26 }, (_, i) => i),
        0,
      ),
    ).toMatchObject({ hasNext: true, items: Array.from({ length: 25 }, (_, i) => i) });
    expect(pageResult([], 25).hasNext).toBe(false);
    expect(pageResult(Array(26).fill(0), 99975).hasNext).toBe(false);
    expect(() => required(null)).toThrow(DomainError);
  });
});
describe('merchant result presentation', () => {
  it('never presents untested or incomplete activity as healthy', () => {
    expect(overviewSummary([], [])).toBe('No checks yet');
    expect(overviewSummary([{ status: 'ERROR' } as TestRun], [])).toBe(
      'Store health not confirmed',
    );
    expect(
      overviewSummary([{ status: 'COMPLETED', outcome: 'PASSED' } as TestRun], [{} as Incident]),
    ).toBe('Open incidents need attention');
    expect(runSummary({ status: 'ERROR', outcome: 'ERROR' })).toBe('Check could not complete');
    expect(runSummary({ status: 'COMPLETED', outcome: null })).toBe('Result unavailable');
  });
  it('formats times in a stable timezone and restricts expired evidence', () => {
    expect(timestamp('2026-09-30T12:00:00.000Z')).toBe('2026-09-30 12:00:00 UTC');
    expect(timestamp(null)).toBe('Not recorded');
    expect(evidenceAvailable({ status: 'READY', expiresAt: new Date(1000) }, 1000)).toBe(false);
    expect(evidenceAvailable({ status: 'FAILED', expiresAt: new Date(2000) }, 1000)).toBe(false);
    expect(evidenceAvailable({ status: 'READY', expiresAt: new Date(2000) }, 1000)).toBe(true);
  });
  it('uses same-origin JSON mutation, no caching and no automatic retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ error: { code: 'CONFLICT' } }, { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(merchantApi('monitors/test', 'PATCH', { version: 2 })).rejects.toThrow('Reload');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/app/api/monitors/test',
      expect.objectContaining({
        method: 'PATCH',
        cache: 'no-store',
        redirect: 'error',
        body: '{"version":2}',
      }),
    );
  });
  it('treats HTML authentication pages as a session failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }),
        ),
    );
    await expect(merchantApi('runs')).rejects.toThrow('session');
  });
});
