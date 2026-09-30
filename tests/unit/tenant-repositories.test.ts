import { describe, expect, it, vi } from 'vitest';
import { createTenantRepositories, type PrismaClient } from '../../packages/database/src/index.js';
import { publicRunSelection } from '../../packages/database/src/run-selection.js';
import type { Monitor, Shop } from '../../packages/domain/src/index.js';
import {
  createMonitorSchema,
  validate,
  ValidationError,
} from '../../packages/contracts/src/index.js';

const id = 'ce42d97b-795d-42f8-b126-62b00d7c18dd';
const shopId = 'demo.myshopify.com';
const shop: Shop = {
  id: shopId,
  shopifyId: null,
  name: null,
  storefrontUrl: null,
  currencyCode: null,
  installedAt: new Date(),
  uninstalledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const input = validate(createMonitorSchema, {
  name: 'Product',
  productId: 'gid://shopify/Product/1',
  variantId: 'gid://shopify/ProductVariant/2',
  device: 'MOBILE',
});
const monitor: Monitor = {
  ...input,
  id,
  shopId,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};
function fixture() {
  const tx = {
    incident: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    incidentOccurrence: { findMany: vi.fn().mockResolvedValue([]) },
    runAnalysis: { findMany: vi.fn().mockResolvedValue([]) },
    aiAnalysis: { findMany: vi.fn().mockResolvedValue([]) },
    shop: { findUnique: vi.fn().mockResolvedValue(shop) },
    monitor: {
      create: vi.fn().mockResolvedValue(monitor),
      findFirst: vi.fn().mockResolvedValue(monitor),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...monitor, version: 2 }),
    },
    testRun: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    runStep: { findMany: vi.fn().mockResolvedValue([]) },
    artifact: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  // The double exposes only exercised Prisma delegates. PostgreSQL tests cover real behavior.
  const transaction = vi.fn((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
  const db = { $transaction: transaction } as unknown as PrismaClient;
  return { tx, transaction, repositories: createTenantRepositories(db, shopId) };
}
describe('tenant-scoped Prisma query construction', () => {
  it('binds all reads and lists to the authenticated shop', async () => {
    const { tx, repositories } = fixture();
    await repositories.shops.get();
    await repositories.monitors.get(id);
    await repositories.runs.get(id);
    await repositories.runs.steps(id);
    await repositories.artifacts.list(id);
    await repositories.artifacts.get(id);
    await repositories.analyses.list(id);
    await repositories.aiAnalyses.list(id);
    expect(tx.aiAnalysis.findMany).toHaveBeenCalledWith({
      where: { shopId, runId: id },
      orderBy: { attempt: 'asc' },
      take: 3,
    });
    await repositories.incidents.list({ limit: 5, offset: 2, status: 'OPEN', monitorId: id });
    await repositories.incidents.get(id);
    await repositories.incidents.occurrences(id, { limit: 5, offset: 2 });
    expect(tx.incident.findMany).toHaveBeenCalledWith({
      where: { shopId, status: 'OPEN', monitorId: id },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      take: 5,
      skip: 2,
    });
    expect(tx.incident.findFirst).toHaveBeenCalledWith({ where: { shopId, id } });
    expect(tx.incidentOccurrence.findMany).toHaveBeenCalledWith({
      where: { shopId, incidentId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      skip: 2,
    });
    expect(tx.runAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { shopId, runId: id }, take: 3 }),
    );
    expect(tx.artifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { shopId, runId: id }, take: 33 }),
    );
    expect(tx.artifact.findFirst).toHaveBeenCalledWith({
      where: { shopId, id, status: 'READY', expiresAt: { gt: expect.any(Date) as unknown } },
    });
    expect(tx.runStep.findMany).toHaveBeenCalledWith({
      where: { shopId, runId: id },
      orderBy: [{ attempt: 'asc' }, { position: 'asc' }],
      take: 21,
    });
    await repositories.monitors.list({ limit: 5, offset: 2 });
    await repositories.runs.list({ monitorId: id, limit: 5, offset: 2 });
    expect(tx.shop.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: shopId } }),
    );
    expect(tx.monitor.findFirst).toHaveBeenCalledWith({ where: { shopId, id } });
    expect(tx.testRun.findFirst).toHaveBeenCalledWith({
      where: { shopId, id },
      select: publicRunSelection,
    });
    expect(tx.monitor.findMany).toHaveBeenCalledWith({
      where: { shopId },
      take: 5,
      skip: 2,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(tx.testRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { shopId, monitorId: id }, take: 5, skip: 2 }),
    );
    const selection = tx.shop.findUnique.mock.calls[0]?.[0] as { select: Record<string, boolean> };
    expect(selection.select).not.toHaveProperty('sessions');
    expect(selection.select).not.toHaveProperty('scopes');
  });
  it('rejects forged tenant fields before any transaction', () => {
    const { repositories, transaction } = fixture();
    expect(() =>
      repositories.monitors.create({ ...input, shopId: 'other.myshopify.com' } as typeof input),
    ).toThrow(ValidationError);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('creates records with server tenant and immutable run snapshot', async () => {
    const { repositories, tx, transaction } = fixture();
    await repositories.monitors.create(input);
    await repositories.runs.create(id);
    expect(tx.monitor.create).toHaveBeenCalledWith({ data: { ...input, shopId } });
    expect(tx.testRun.create).toHaveBeenCalledWith({
      select: publicRunSelection,
      data: {
        shopId,
        monitorId: id,
        monitorVersion: 1,
        scenario: input.scenario,
        productId: input.productId,
        variantId: input.variantId,
        device: input.device,
        status: 'QUEUED',
        dispatchRequested: true,
      },
    });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it('uses tenant and version predicates for updates and clears stale variant selection', async () => {
    const { repositories, tx } = fixture();
    await repositories.monitors.update(id, { version: 1, productId: 'gid://shopify/Product/5' });
    expect(tx.monitor.updateMany).toHaveBeenCalledWith({
      where: { shopId, id, version: 1 },
      data: { productId: 'gid://shopify/Product/5', variantId: null, version: { increment: 1 } },
    });
    expect(tx.monitor.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { shopId_id: { shopId, id } },
    });
  });
  it('rejects stale edits and atomic update conflicts', async () => {
    const { repositories, tx } = fixture();
    await expect(repositories.monitors.update(id, { version: 2, enabled: false })).rejects.toThrow(
      'CONFLICT',
    );
    expect(tx.monitor.updateMany).not.toHaveBeenCalled();
    tx.monitor.updateMany.mockResolvedValue({ count: 0 });
    await expect(repositories.monitors.update(id, { version: 1, enabled: false })).rejects.toThrow(
      'CONFLICT',
    );
  });
  it('does not reveal or mutate a monitor outside the current tenant', async () => {
    const { repositories, tx } = fixture();
    tx.monitor.findFirst.mockResolvedValue(null);
    expect(await repositories.monitors.get(id)).toBeNull();
    await expect(repositories.monitors.update(id, { version: 1, name: 'forged' })).rejects.toThrow(
      'NOT_FOUND',
    );
    await expect(repositories.runs.create(id)).rejects.toThrow('NOT_FOUND');
    expect(tx.monitor.updateMany).not.toHaveBeenCalled();
    expect(tx.testRun.create).not.toHaveBeenCalled();
  });
  it('rejects disabled monitors and inactive shops', async () => {
    const { repositories, tx } = fixture();
    tx.monitor.findFirst.mockResolvedValue({ ...monitor, enabled: false });
    await expect(repositories.runs.create(id)).rejects.toThrow('MONITOR_DISABLED');
    tx.shop.findUnique.mockResolvedValue({ ...shop, uninstalledAt: new Date() });
    await expect(repositories.monitors.create(input)).rejects.toThrow('SHOP_INACTIVE');
    await expect(repositories.runs.list({ limit: 25, offset: 0 })).rejects.toThrow('SHOP_INACTIVE');
    expect(tx.testRun.create).not.toHaveBeenCalled();
    expect(tx.monitor.create).not.toHaveBeenCalled();
  });
});
