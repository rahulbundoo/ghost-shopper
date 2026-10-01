import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  repositories: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  history: vi.fn(),
}));
vi.mock('../../apps/web/app/hardening.server.js', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../../apps/web/app/shopify.server.js', () => ({
  getRuntime: () => ({ db: {}, shopify: { authenticate: { admin: mocks.authenticate } } }),
  withShopifyBoundary: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@ghostshopper/database', () => ({ createTenantRepositories: mocks.repositories }));
import { action, loader } from '../../apps/web/app/routes/api.notifications.js';
import { DomainError } from '../../packages/domain/src/index.js';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ session: { shop: 'verified.myshopify.com' } });
  mocks.get.mockResolvedValue(null);
  mocks.history.mockResolvedValue([]);
  mocks.update.mockResolvedValue({ version: 1 });
  mocks.repositories.mockReturnValue({
    notifications: { get: mocks.get, update: mocks.update, history: mocks.history },
  });
});
function invoke(method: string, body?: unknown, authenticated = true) {
  const request = new Request(
    'https://app.example/app/api/notifications?shopId=other.myshopify.com',
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: 'Bearer fixture-token' } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return (method === 'GET' ? loader : action)({
    request,
    params: {},
    context: {},
    url: new URL(request.url),
    pattern: '/app/api/notifications',
  });
}
describe('notification settings API', () => {
  it.each(['GET', 'PATCH'])('requires bearer authentication for %s', async (method) => {
    expect((await invoke(method, undefined, false)).status).toBe(401);
    expect(mocks.repositories).not.toHaveBeenCalled();
  });
  it('uses authenticated tenant and no-store on reads', async () => {
    const response = await invoke('GET');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ settings: null, history: [] });
    expect(mocks.repositories).toHaveBeenCalledWith({}, 'verified.myshopify.com');
  });
  it('validates email, version and tenant selectors before writes', async () => {
    const input = { email: 'owner@example.com', enabled: true, recoveryEnabled: true, version: 0 };
    for (const body of [
      { ...input, email: 'bad' },
      { ...input, shopId: 'forged' },
      { ...input, version: -1 },
    ])
      expect((await invoke('PATCH', body)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect((await invoke('PATCH', input)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(input);
  });
  it('reports conflicts without overwriting settings and rejects unsupported methods', async () => {
    mocks.update.mockRejectedValue(new DomainError('CONFLICT'));
    expect(
      (
        await invoke('PATCH', {
          email: 'owner@example.com',
          enabled: false,
          recoveryEnabled: false,
          version: 1,
        })
      ).status,
    ).toBe(409);
    expect((await invoke('POST', {})).status).toBe(405);
  });
});
