import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  repositories: vi.fn(),
  getRun: vi.fn(),
  analyses: vi.fn(),
  aiAnalyses: vi.fn(),
}));
vi.mock('../../apps/web/app/hardening.server.js', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../../apps/web/app/shopify.server.js', () => ({
  getRuntime: () => ({ db: {}, shopify: { authenticate: { admin: mocks.authenticate } } }),
  withShopifyBoundary: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@ghostshopper/database', () => ({ createTenantRepositories: mocks.repositories }));
import { loader } from '../../apps/web/app/routes/api.run.js';
const id = 'ce42d97b-795d-42f8-b126-62b00d7c18dd';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ session: { shop: 'verified.myshopify.com' } });
  mocks.getRun.mockResolvedValue({ id });
  mocks.analyses.mockResolvedValue([{ attempt: 1, score: 0, findings: [{ source: 'DETECTED' }] }]);
  mocks.aiAnalyses.mockResolvedValue([{ source: 'AI_ANALYSIS', status: 'FAILED', result: null }]);
  mocks.repositories.mockReturnValue({
    runs: { get: mocks.getRun, steps: vi.fn().mockResolvedValue([]) },
    artifacts: { list: vi.fn().mockResolvedValue([]) },
    analyses: { list: mocks.analyses },
    aiAnalyses: { list: mocks.aiAnalyses },
  });
});
function invoke(auth = true) {
  return loader({
    request: new Request(`https://app.example/app/api/runs/${id}?shopId=forged.myshopify.com`, {
      headers: auth ? { Authorization: 'Bearer session' } : {},
    }),
    params: { runId: id },
    context: {},
    url: new URL('https://app.example'),
    pattern: '/app/api/runs/:runId',
  });
}
describe('run analysis API authorization', () => {
  it('requires authentication before reading analyses', async () => {
    expect((await invoke(false)).status).toBe(401);
    expect(mocks.analyses).not.toHaveBeenCalled();
    expect(mocks.aiAnalyses).not.toHaveBeenCalled();
  });
  it('does not fetch analyses for an absent or cross-tenant run', async () => {
    mocks.getRun.mockResolvedValue(null);
    expect((await invoke()).status).toBe(404);
    expect(mocks.analyses).not.toHaveBeenCalled();
  });
  it('returns analysis under the authenticated shop without caching', async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      analyses: [{ score: 0, findings: [{ source: 'DETECTED' }] }],
      aiAnalyses: [{ source: 'AI_ANALYSIS', status: 'FAILED', result: null }],
    });
    expect(mocks.repositories).toHaveBeenCalledWith({}, 'verified.myshopify.com');
    expect(mocks.analyses).toHaveBeenCalledWith(id);
    expect(mocks.aiAnalyses).toHaveBeenCalledWith(id);
  });
});
