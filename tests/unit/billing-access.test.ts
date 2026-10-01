import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  repository: vi.fn(),
  checkout: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
  summary: vi.fn(),
}));
vi.mock('../../apps/web/app/hardening.server.js', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../../apps/web/app/shopify.server.js', () => ({
  getRuntime: () => ({
    db: {},
    config: { appUrl: 'https://app.example.com' },
    billing: {
      priceUsd: '19.00',
      paidRunLimit: 1000,
      trialRunLimit: 100,
      trialDays: 14,
      test: true,
    },
    shopify: { authenticate: { admin: mocks.authenticate } },
  }),
  withShopifyBoundary: (op: () => Promise<unknown>) => op(),
}));
vi.mock('@ghostshopper/database', () => ({
  PrismaBillingRepository: class {
    constructor(...args: unknown[]) {
      mocks.repository(...args);
    }
    summary = mocks.summary;
  },
  createTenantRepositories: vi.fn(),
}));
vi.mock('@ghostshopper/shopify', () => ({ ShopifyBillingProvider: class {} }));
vi.mock('@ghostshopper/application', () => ({
  BillingService: class {
    refresh = mocks.refresh;
    checkout = mocks.checkout;
    cancel = mocks.cancel;
  },
  MonitoringService: class {},
}));
import { billingRequest } from '../../apps/web/app/billing.server.js';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    session: { shop: 'verified.myshopify.com' },
    admin: { graphql: vi.fn() },
  });
  mocks.summary.mockResolvedValue({ used: 0 });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.checkout.mockResolvedValue('https://admin.shopify.com/confirm');
});
function request(method: string, body?: unknown, bearer = true) {
  return new Request(
    'https://app.example.com/app/api/billing?shop=forged.myshopify.com&charge_id=forged',
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: 'Bearer fixture' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}
describe('authenticated billing boundary', () => {
  it.each(['GET', 'POST'])(
    'rejects cookie-only %s before provider/database access',
    async (method) => {
      expect((await billingRequest(request(method, undefined, false), true)).status).toBe(401);
      expect(mocks.authenticate).not.toHaveBeenCalled();
      expect(mocks.repository).not.toHaveBeenCalled();
    },
  );
  it('ignores forged shop and charge IDs and verifies provider on return', async () => {
    const response = await billingRequest(request('GET'), true);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.repository.mock.calls[0]?.[1]).toBe('verified.myshopify.com');
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it.each([
    { action: 'checkout', price: '0.01' },
    { action: 'cancel', id: 'forged' },
    { action: 'unknown' },
  ])('rejects client billing authority %j', async (body) => {
    expect((await billingRequest(request('POST', body), true)).status).toBe(400);
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('allows explicit checkout but never redirects or activates from a client-provided ID', async () => {
    const response = await billingRequest(request('POST', { action: 'checkout' }), true);
    expect(await response.json()).toEqual({ confirmationUrl: 'https://admin.shopify.com/confirm' });
    expect(mocks.checkout).toHaveBeenCalledOnce();
    expect((await billingRequest(request('DELETE'), true)).status).toBe(405);
  });
  it('keeps usage readable when provider synchronization fails', async () => {
    mocks.refresh.mockRejectedValue(new Error('provider'));
    const response = await billingRequest(request('GET'), true);
    expect(await response.json()).toMatchObject({ syncFailed: true, summary: { used: 0 } });
  });
});
