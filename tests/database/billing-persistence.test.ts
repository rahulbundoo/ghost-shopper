import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  PrismaBillingRepository,
  PrismaAutomationStore,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService } from '../../packages/application/src/index.js';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must select a dedicated migrated test database.');
const db = createDatabase(url);
const shopId = `billing-${randomUUID()}.myshopify.com`;
const otherId = `billing-${randomUUID()}.myshopify.com`;
const raceId = `billing-${randomUUID()}.myshopify.com`;
const shops = new ShopRepository(db);
const policy = { priceUsd: '19.00', paidRunLimit: 2, trialDays: 14, trialRunLimit: 1, test: true };
const service = new MonitoringService(createTenantRepositories(db, shopId, policy));
const other = new MonitoringService(createTenantRepositories(db, otherId, policy));
const billing = new PrismaBillingRepository(db, shopId, policy);
const input = {
  name: 'Billing fixture',
  productId: 'gid://shopify/Product/1',
  device: 'DESKTOP',
  frequency: 'DAILY',
};
beforeAll(async () => {
  await shops.markInstalled(shopId, '');
  await shops.markInstalled(otherId, '');
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: { in: [shopId, otherId, raceId] } } });
  } finally {
    await db.$disconnect();
  }
});
describe('PostgreSQL billing and usage', () => {
  it('shares the last unit between concurrent scheduled and manual admissions', async () => {
    await shops.markInstalled(raceId, '');
    const race = new MonitoringService(createTenantRepositories(db, raceId, policy));
    await new PrismaBillingRepository(db, raceId, policy).summary();
    const monitor = await race.createMonitor(input);
    await Promise.allSettled([
      new PrismaAutomationStore(db, policy).schedule(),
      race.createTestRun({ monitorId: monitor.id }),
    ]);
    expect(await db.testRun.count({ where: { shopId: raceId } })).toBe(1);
    expect(await db.usageRecord.count({ where: { shopId: raceId } })).toBe(1);
  });
  it('admits one of two concurrent manual runs across different monitors at the trial limit', async () => {
    await billing.summary();
    const first = await service.createMonitor(input);
    const second = await service.createMonitor(input);
    const results = await Promise.allSettled([
      service.createTestRun({ monitorId: first.id }),
      service.createTestRun({ monitorId: second.id }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.usageRecord.count({ where: { shopId } })).toBe(1);
    expect((await billing.summary()).eligible).toBe(false);
    await new PrismaAutomationStore(db, policy).schedule();
    expect(await db.testRun.count({ where: { shopId } })).toBe(1);
    expect(await db.usageRecord.count({ where: { shopId } })).toBe(1);
  });
  it('rolls back run and usage together and enforces compound tenant and duplicate-run constraints', async () => {
    const monitor = await other.createMonitor(input);
    const run = await other.createTestRun({ monitorId: monitor.id });
    await expect(
      db.usageRecord.create({ data: { shopId, runId: run.id, periodKey: 'forged' } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      db.usageRecord.create({ data: { shopId: otherId, runId: run.id, periodKey: 'trial' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect((await new PrismaBillingRepository(db, otherId, policy).summary()).used).toBe(1);
    await expect(
      db.$transaction(async (tx) => {
        await tx.usageRecord.deleteMany({ where: { shopId: otherId } });
        throw new Error('ROLLBACK');
      }),
    ).rejects.toThrow('ROLLBACK');
    expect(await db.usageRecord.count({ where: { shopId: otherId } })).toBe(1);
  });
  it('starts a paid allowance only from verified state, preserves it on refresh and resets on renewal', async () => {
    const periodEnd = new Date(Date.now() + 30 * 86400000);
    await billing.sync({ providerId: 'gid://shopify/AppSubscription/1', periodEnd }, new Date());
    expect((await billing.summary()).used).toBe(0);
    const monitor = await service.createMonitor(input);
    await service.createTestRun({ monitorId: monitor.id });
    expect((await billing.summary()).used).toBe(1);
    await billing.sync({ providerId: 'gid://shopify/AppSubscription/1', periodEnd }, new Date());
    expect((await billing.summary()).used).toBe(1);
    await billing.sync(
      {
        providerId: 'gid://shopify/AppSubscription/1',
        periodEnd: new Date(periodEnd.getTime() + 30 * 86400000),
      },
      new Date(Date.now() + 1),
    );
    expect((await billing.summary()).used).toBe(0);
    await billing.sync(null, new Date(Date.now() + 2));
    expect((await billing.summary()).eligible).toBe(false);
  });
  it('serializes checkout reservations and preserves trial history through uninstall and reinstall', async () => {
    const results = await Promise.allSettled([
      billing.reserveCheckout(),
      billing.reserveCheckout(),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const before = await billing.summary();
    await shops.uninstall(shopId);
    await expect(billing.summary()).rejects.toThrow('SHOP_INACTIVE');
    await shops.markInstalled(shopId, '');
    const after = await billing.summary();
    expect(after.trialEndsAt).toEqual(before.trialEndsAt);
    expect(after.eligible).toBe(false);
    await shops.uninstall(shopId);
    await shops.redactUninstalledShop(shopId);
    expect(await db.subscription.count({ where: { shopId } })).toBe(0);
    expect(await db.usageRecord.count({ where: { shopId } })).toBe(0);
  });
});
