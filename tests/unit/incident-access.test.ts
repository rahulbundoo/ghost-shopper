import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  repositories: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  occurrences: vi.fn(),
}));
vi.mock('../../apps/web/app/shopify.server.js', () => ({
  getRuntime: () => ({ db: {}, shopify: { authenticate: { admin: mocks.authenticate } } }),
  withShopifyBoundary: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@ghostshopper/database', () => ({ createTenantRepositories: mocks.repositories }));
import { loader as detail } from '../../apps/web/app/routes/api.incident.js';
import { loader as list } from '../../apps/web/app/routes/api.incidents.js';
const id = 'ce42d97b-795d-42f8-b126-62b00d7c18dd';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ session: { shop: 'verified.myshopify.com' } });
  mocks.get.mockResolvedValue({ id, status: 'OPEN', occurrenceCount: 3 });
  mocks.list.mockResolvedValue([]);
  mocks.occurrences.mockResolvedValue([]);
  mocks.repositories.mockReturnValue({
    incidents: { get: mocks.get, list: mocks.list, occurrences: mocks.occurrences },
  });
});
function invoke(loader: typeof detail, query = '', auth = true) {
  return loader({
    request: new Request(`https://app.example/app/api/incidents/${id}${query}`, {
      headers: auth ? { Authorization: 'Bearer token' } : {},
    }),
    params: { incidentId: id },
    context: {},
    url: new URL('https://app.example'),
    pattern: '/app/api/incidents/:incidentId',
  });
}
describe('incident read authentication', () => {
  it.each([detail, list])(
    'authenticates every endpoint before repository access',
    async (loader) => {
      expect((await invoke(loader, '', false)).status).toBe(401);
      expect(mocks.repositories).not.toHaveBeenCalled();
    },
  );
  it('does not reveal occurrence history for another tenant or missing incident', async () => {
    mocks.get.mockResolvedValue(null);
    expect((await invoke(detail)).status).toBe(404);
    expect(mocks.occurrences).not.toHaveBeenCalled();
  });
  it('returns bounded occurrence history for the verified tenant with no-store', async () => {
    const response = await invoke(detail, '?limit=5&offset=2');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      incident: { occurrenceCount: 3 },
      occurrences: [],
    });
    expect(mocks.repositories).toHaveBeenCalledWith({}, 'verified.myshopify.com');
    expect(mocks.occurrences).toHaveBeenCalledWith(id, { limit: 5, offset: 2 });
  });
  it('validates status, duplicate keys and caller-provided tenant selectors', async () => {
    for (const query of ['?status=MUTED', '?status=OPEN&status=RESOLVED', '?shopId=forged'])
      expect((await invoke(list, query)).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('accepts bounded monitor and status filters', async () => {
    expect((await invoke(list, `?status=OPEN&monitorId=${id}`)).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({
      status: 'OPEN',
      monitorId: id,
      limit: 25,
      offset: 0,
    });
  });
});
