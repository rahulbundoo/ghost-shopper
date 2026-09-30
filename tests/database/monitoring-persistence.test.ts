import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService } from '../../packages/application/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'TEST_DATABASE_URL must point to a migrated, dedicated PostgreSQL test database.',
  );
const db = createDatabase(databaseUrl);
const suffix = randomUUID();
const shopA = `phase2-a-${suffix}.myshopify.com`;
const shopB = `phase2-b-${suffix}.myshopify.com`;
const lifecycle = new ShopRepository(db);
const a = new MonitoringService(createTenantRepositories(db, shopA));
const b = new MonitoringService(createTenantRepositories(db, shopB));
const input = {
  name: 'Test monitor',
  productId: 'gid://shopify/Product/1',
  variantId: 'gid://shopify/ProductVariant/2',
  device: 'DESKTOP',
};
beforeAll(async () => {
  await db.$connect();
  await lifecycle.markInstalled(shopA, '');
  await lifecycle.markInstalled(shopB, '');
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: { in: [shopA, shopB] } } });
  } finally {
    await db.$disconnect();
  }
});

describe('PostgreSQL monitoring persistence and isolation', () => {
  it('creates and retrieves all three core entities with no credentials in shop results', async () => {
    const shop = await a.getShop();
    expect(shop.id).toBe(shopA);
    expect(shop).not.toHaveProperty('sessions');
    expect(shop).not.toHaveProperty('scopes');
    const monitor = await a.createMonitor(input);
    const run = await a.createTestRun({ monitorId: monitor.id });
    // A fresh client proves persistence does not depend on an in-memory repository cache.
    const reopened = createDatabase(databaseUrl);
    try {
      const other = new MonitoringService(createTenantRepositories(reopened, shopA));
      expect(await other.getMonitor(monitor.id)).toEqual(monitor);
      expect(await other.getTestRun(run.id)).toEqual(run);
    } finally {
      await reopened.$disconnect();
    }
    expect(run).toMatchObject({
      status: 'QUEUED',
      outcome: null,
      shopId: shopA,
      monitorId: monitor.id,
      monitorVersion: 1,
    });
  });
  it('does not read, edit or create runs against another tenant', async () => {
    const monitor = await a.createMonitor(input);
    const run = await a.createTestRun({ monitorId: monitor.id });
    expect(await b.getMonitor(monitor.id)).toBeNull();
    expect(await b.getTestRun(run.id)).toBeNull();
    await expect(b.updateMonitor(monitor.id, { version: 1, name: 'attack' })).rejects.toThrow(
      'NOT_FOUND',
    );
    await expect(b.createTestRun({ monitorId: monitor.id })).rejects.toThrow('NOT_FOUND');
    expect(await b.listTestRuns({ monitorId: monitor.id })).toEqual([]);
    expect((await b.listMonitors()).every((m) => m.shopId === shopB)).toBe(true);
  });
  it('enforces the compound tenant foreign key even when the repository is bypassed', async () => {
    const monitor = await a.createMonitor(input);
    await expect(
      db.testRun.create({
        data: {
          shopId: shopB,
          monitorId: monitor.id,
          monitorVersion: 1,
          scenario: 'PURCHASE_JOURNEY',
          productId: input.productId,
          device: 'DESKTOP',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
  it('keeps run snapshots stable across monitor edits and prevents stale writes', async () => {
    const monitor = await a.createMonitor(input);
    const run = await a.createTestRun({ monitorId: monitor.id });
    const edited = await a.updateMonitor(monitor.id, {
      version: 1,
      productId: 'gid://shopify/Product/3',
      device: 'MOBILE',
      enabled: false,
    });
    expect(edited).toMatchObject({ version: 2, variantId: null, enabled: false });
    expect(await a.getTestRun(run.id)).toEqual(run);
    await expect(a.updateMonitor(monitor.id, { version: 1, name: 'stale' })).rejects.toThrow(
      'CONFLICT',
    );
    await expect(a.createTestRun({ monitorId: monitor.id })).rejects.toThrow('MONITOR_DISABLED');
  });
  it('allows only one of two concurrent edits with the same version', async () => {
    const monitor = await a.createMonitor(input);
    const results = await Promise.allSettled([
      a.updateMonitor(monitor.id, { version: 1, name: 'One' }),
      a.updateMonitor(monitor.id, { version: 1, name: 'Two' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await a.getMonitor(monitor.id))?.version).toBe(2);
  });
  it('paginates deterministically and scopes filtered run lists', async () => {
    const monitor = await b.createMonitor(input);
    await b.createTestRun({ monitorId: monitor.id });
    const list = await a.listMonitors({ limit: 2 });
    expect(list).toHaveLength(2);
    expect((await a.listMonitors({ limit: 1, offset: 1 }))[0]?.id).toBe(list[1]?.id);
    expect(
      (await b.listTestRuns({ monitorId: monitor.id })).every(
        (r) => r.shopId === shopB && r.monitorId === monitor.id,
      ),
    ).toBe(true);
  });
  it('rejects inconsistent run states at the database boundary', async () => {
    const monitor = await a.createMonitor(input);
    await expect(
      db.testRun.create({
        data: {
          shopId: shopA,
          monitorId: monitor.id,
          monitorVersion: 1,
          scenario: 'PURCHASE_JOURNEY',
          productId: input.productId,
          device: 'DESKTOP',
          status: 'COMPLETED',
        },
      }),
    ).rejects.toThrow();
  });
  it('blocks inactive tenants and redacts only their monitoring data', async () => {
    const monitor = await a.createMonitor(input);
    const run = await a.createTestRun({ monitorId: monitor.id });
    const unaffected = await b.createMonitor(input);
    await lifecycle.uninstall(shopA);
    await expect(a.getMonitor(monitor.id)).rejects.toThrow('SHOP_INACTIVE');
    await expect(a.createMonitor(input)).rejects.toThrow('SHOP_INACTIVE');
    await lifecycle.redactUninstalledShop(shopA);
    expect(await db.monitor.findUnique({ where: { id: monitor.id } })).toBeNull();
    expect(await db.testRun.findUnique({ where: { id: run.id } })).toBeNull();
    expect(await b.getMonitor(unaffected.id)).not.toBeNull();
  });
});
