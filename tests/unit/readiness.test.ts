import { afterEach, describe, expect, it, vi } from 'vitest';
const { runtime, transaction, heartbeat } = vi.hoisted(() => ({
  runtime: vi.fn(),
  transaction: vi.fn(),
  heartbeat: vi.fn(),
}));
vi.mock('../../apps/web/app/shopify.server.js', () => ({ getRuntime: runtime }));
import { loader } from '../../apps/web/app/routes/ready.js';
const token = 'r'.repeat(40);
const invoke = (authorization?: string) =>
  loader({
    request: new Request('https://app.example/ready', {
      headers: authorization ? { Authorization: authorization } : {},
    }),
    params: {},
    context: {},
    url: new URL('https://app.example/ready'),
    pattern: '/ready',
  });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe('dependency readiness', () => {
  it('rejects unauthenticated probes before loading service credentials or touching the database', async () => {
    vi.stubEnv('READINESS_TOKEN', token);
    const response = await invoke();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(runtime).not.toHaveBeenCalled();
  });
  it.each([true, false])('requires a fresh dependency heartbeat: %s', async (fresh) => {
    vi.stubEnv('READINESS_TOKEN', token);
    heartbeat.mockResolvedValue(fresh ? { id: 'runner-fixture' } : null);
    transaction.mockImplementation(async (read: (tx: unknown) => Promise<unknown>) =>
      read({ $queryRaw: vi.fn(), serviceHeartbeat: { findFirst: heartbeat } }),
    );
    runtime.mockReturnValue({ db: { $transaction: transaction } });
    const response = await invoke(`Bearer ${token}`);
    expect(response.status).toBe(fresh ? 200 : 503);
    expect(await response.json()).toEqual({ status: fresh ? 'ready' : 'unavailable' });
    expect(heartbeat).toHaveBeenCalledWith({
      where: { updatedAt: { gt: expect.any(Date) as unknown } },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 3000,
      maxWait: 1000,
    });
  });
  it('returns an opaque 503 on database failure', async () => {
    vi.stubEnv('READINESS_TOKEN', token);
    runtime.mockImplementation(() => {
      throw new Error('private connection secret');
    });
    const response = await invoke(`Bearer ${token}`);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
  });
});
