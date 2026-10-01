import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  repositories: vi.fn(),
  download: vi.fn(),
}));
vi.mock('../../apps/web/app/hardening.server.js', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../../apps/web/app/shopify.server.js', () => ({
  getRuntime: () => ({ db: {}, shopify: { authenticate: { admin: mocks.authenticate } } }),
  withShopifyBoundary: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@ghostshopper/database', () => ({ createTenantRepositories: mocks.repositories }));
vi.mock('../../apps/web/app/artifacts.server.js', () => ({ artifactDownload: mocks.download }));
import { loader } from '../../apps/web/app/routes/api.artifact.js';
const id = 'ce42d97b-795d-42f8-b126-62b00d7c18dd';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ session: { shop: 'verified.myshopify.com' } });
});
function invoke(auth = true) {
  return loader({
    request: new Request(
      `https://app.example/app/api/artifacts/${id}/download?shopId=forged.myshopify.com`,
      {
        headers: auth ? { Authorization: 'Bearer session' } : {},
      },
    ),
    params: { artifactId: id },
    context: {},
    url: new URL('https://app.example'),
    pattern: '/app/api/artifacts/:artifactId/download',
  });
}
describe('private artifact downloads', () => {
  it('requires authentication before looking up or signing', async () => {
    expect((await invoke(false)).status).toBe(401);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.repositories).not.toHaveBeenCalled();
  });
  it('returns identical not-found for expired, missing and cross-tenant artifacts', async () => {
    mocks.repositories.mockReturnValue({ artifacts: { get: vi.fn().mockResolvedValue(null) } });
    expect((await invoke()).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.repositories).toHaveBeenCalledWith({}, 'verified.myshopify.com');
  });
  it('signs only the authorized stored artifact, without caching the capability', async () => {
    const artifact = { id, storageKey: 'server-key' };
    mocks.repositories.mockReturnValue({ artifacts: { get: vi.fn().mockResolvedValue(artifact) } });
    mocks.download.mockResolvedValue({
      url: 'https://storage.example/signed',
      expiresAt: new Date(),
    });
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mocks.download).toHaveBeenCalledWith(artifact);
  });
});
