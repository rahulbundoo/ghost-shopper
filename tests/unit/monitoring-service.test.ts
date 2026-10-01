import { describe, expect, it, vi } from 'vitest';
import {
  MonitoringService,
  type TenantRepositories,
} from '../../packages/application/src/index.js';
import { ValidationError } from '../../packages/contracts/src/index.js';

function fixture() {
  const repositories = {
    notifications: { get: vi.fn(), update: vi.fn(), history: vi.fn() },
    incidents: { list: vi.fn(), get: vi.fn(), occurrences: vi.fn() },
    analyses: { list: vi.fn() },
    aiAnalyses: { list: vi.fn() },
    artifacts: { list: vi.fn(), get: vi.fn() },
    shops: { get: vi.fn() },
    monitors: { create: vi.fn(), get: vi.fn(), list: vi.fn(), update: vi.fn() },
    runs: { create: vi.fn(), get: vi.fn(), list: vi.fn(), steps: vi.fn() },
  } satisfies TenantRepositories;
  return { repositories, service: new MonitoringService(repositories) };
}
const id = 'ce42d97b-795d-42f8-b126-62b00d7c18dd';
describe('monitoring use cases', () => {
  it('validates create input before calling a repository', async () => {
    const { repositories, service } = fixture();
    expect(() => service.createMonitor({ shopId: 'other.myshopify.com' })).toThrow(ValidationError);
    expect(repositories.monitors.create).not.toHaveBeenCalled();
    await service.createMonitor({
      name: ' Product ',
      productId: 'gid://shopify/Product/1',
      device: 'MOBILE',
    });
    expect(repositories.monitors.create).toHaveBeenCalledWith({
      name: 'Product',
      productId: 'gid://shopify/Product/1',
      variantId: null,
      device: 'MOBILE',
      scenario: 'PURCHASE_JOURNEY',
      frequency: 'DAILY',
      enabled: true,
    });
  });
  it('keeps client tenant input out of repository calls', async () => {
    const { repositories, service } = fixture();
    expect(() => service.createTestRun({ monitorId: id, shopId: 'other.myshopify.com' })).toThrow(
      ValidationError,
    );
    await service.createTestRun({ monitorId: id });
    expect(repositories.runs.create).toHaveBeenCalledWith(id);
    await service.getShop();
    expect(repositories.shops.get).toHaveBeenCalledWith();
  });
  it('validates identifiers, edits and bounded lists', async () => {
    const { repositories, service } = fixture();
    expect(() => service.getMonitor('not-a-uuid')).toThrow(ValidationError);
    expect(() => service.getTestRun('not-a-uuid')).toThrow(ValidationError);
    await service.getMonitor(id);
    await service.getTestRun(id);
    await service.updateMonitor(id, { version: 1, enabled: false });
    await service.listMonitors();
    await service.listTestRuns({ monitorId: id, limit: 5 });
    expect(repositories.monitors.get).toHaveBeenCalledWith(id);
    expect(repositories.runs.get).toHaveBeenCalledWith(id);
    expect(repositories.monitors.update).toHaveBeenCalledWith(id, { version: 1, enabled: false });
    expect(repositories.monitors.list).toHaveBeenCalledWith({ limit: 25, offset: 0 });
    expect(repositories.runs.list).toHaveBeenCalledWith({ monitorId: id, limit: 5, offset: 0 });
  });
});
