import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../packages/domain/src/index.js';
import { ValidationError } from '../../packages/contracts/src/index.js';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), repositories: vi.fn() }));
vi.mock('../../apps/web/app/shopify.server.js', () => ({
  getRuntime: () => ({ db: {}, shopify: { authenticate: { admin: mocks.authenticate } } }),
  withShopifyBoundary: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock('@ghostshopper/database', () => ({ createTenantRepositories: mocks.repositories }));
import {
  listQuery,
  monitoringRequest,
  readJson,
  jsonResponse,
} from '../../apps/web/app/monitoring.server.js';

function request(body?: string, contentType = 'application/json') {
  return new Request('https://ghostshopper.example/app/api/monitors?shopId=other.myshopify.com', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer test-session-token', 'Content-Type': contentType },
    ...(body !== undefined ? { body } : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ session: { shop: 'verified.myshopify.com' } });
  mocks.repositories.mockReturnValue({
    shops: { get: vi.fn().mockResolvedValue({ id: 'verified.myshopify.com' }) },
  });
});
describe('monitoring resource API boundary', () => {
  it('requires bearer authentication before any runtime access', async () => {
    const operation = vi.fn();
    const response = await monitoringRequest(
      new Request('https://ghostshopper.example/app/api/shop'),
      ['GET'],
      operation,
    );
    expect(response.status).toBe(401);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.repositories).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });
  it('binds repositories only to the verified session and disables caching', async () => {
    const response = await monitoringRequest(request(), ['GET'], async (service) =>
      jsonResponse(await service.getShop()),
    );
    expect(mocks.repositories).toHaveBeenCalledWith({}, 'verified.myshopify.com');
    expect(await response.json()).toEqual({ id: 'verified.myshopify.com' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('preserves SDK authentication challenge headers', async () => {
    mocks.authenticate.mockRejectedValue(
      new Response(null, {
        status: 401,
        headers: { 'X-Shopify-Retry-Invalid-Session-Request': '1' },
      }),
    );
    const response = await monitoringRequest(request(), ['GET'], vi.fn());
    expect(response.status).toBe(401);
    expect(response.headers.get('X-Shopify-Retry-Invalid-Session-Request')).toBe('1');
    expect(mocks.repositories).not.toHaveBeenCalled();
  });
  it('rejects unsupported authenticated methods', async () => {
    const response = await monitoringRequest(request('{}'), ['PATCH'], vi.fn());
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('PATCH');
  });
  it.each([
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['MONITOR_DISABLED', 409],
    ['SHOP_INACTIVE', 403],
  ] as const)('maps %s to a safe response', async (code, status) => {
    const response = await monitoringRequest(request(), ['GET'], () =>
      Promise.reject(new DomainError(code)),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { code } });
  });
  it('maps validation failure without exposing request values', async () => {
    const response = await monitoringRequest(request(), ['GET'], () =>
      Promise.reject(new ValidationError(['name'])),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'INVALID_INPUT', fields: ['name'] } });
  });
  it('accepts JSON only, with a bounded body', async () => {
    expect(await readJson(request('{"name":"Test"}'))).toEqual({ name: 'Test' });
    await expect(readJson(request('broken'))).rejects.toThrow(ValidationError);
    await expect(readJson(request('{}', 'text/plain'))).rejects.toThrow(ValidationError);
    await expect(readJson(request(' '.repeat(16_385)))).rejects.toThrow(ValidationError);
    await expect(readJson(request())).rejects.toThrow(ValidationError);
  });
  it('parses numeric paging fields and rejects duplicate query keys', () => {
    expect(listQuery(new Request('https://ghostshopper.example/?limit=5&offset=2'))).toEqual({
      limit: 5,
      offset: 2,
    });
    expect(() => listQuery(new Request('https://ghostshopper.example/?limit=5&limit=10'))).toThrow(
      ValidationError,
    );
  });
});
