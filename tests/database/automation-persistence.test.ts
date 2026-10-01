import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  PrismaAutomationStore,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService } from '../../packages/application/src/index.js';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must select a dedicated migrated test database.');
const db = createDatabase(url);
const shopId = `automation-${randomUUID()}.myshopify.com`;
const otherId = `automation-${randomUUID()}.myshopify.com`;
const shops = new ShopRepository(db);
const service = new MonitoringService(createTenantRepositories(db, shopId));
const other = new MonitoringService(createTenantRepositories(db, otherId));
const store = new PrismaAutomationStore(db);
const input = {
  name: 'Automatic journey',
  productId: 'gid://shopify/Product/1',
  device: 'DESKTOP',
  frequency: 'HOURLY',
};
beforeAll(async () => {
  await shops.markInstalled(shopId, '');
  await shops.markInstalled(otherId, '');
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: { in: [shopId, otherId] } } });
  } finally {
    await db.$disconnect();
  }
});
describe('PostgreSQL scheduling and email persistence', () => {
  it('creates only one durable run across concurrent scheduler scans and manual requests', async () => {
    const monitor = await service.createMonitor(input);
    await Promise.all([store.schedule(), store.schedule()]);
    expect(await service.listTestRuns({ monitorId: monitor.id })).toHaveLength(1);
    await expect(service.createTestRun({ monitorId: monitor.id })).rejects.toThrow('CONFLICT');
    const row = await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(row.version).toBe(1);
    expect(row.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 3500000);
    const run = (await service.listTestRuns({ monitorId: monitor.id }))[0]!;
    expect(await db.testRun.findUnique({ where: { id: run.id } })).toMatchObject({
      dispatchRequested: true,
      status: 'QUEUED',
    });
  });
  it('skips disabled/inactive tenants and skips catch-up bursts after downtime', async () => {
    const disabled = await service.createMonitor({ ...input, enabled: false });
    const overdue = await service.createMonitor(input);
    await db.monitor.update({ where: { id: overdue.id }, data: { nextRunAt: new Date(0) } });
    await store.schedule();
    await store.schedule();
    expect(await service.listTestRuns({ monitorId: disabled.id })).toHaveLength(0);
    expect(await service.listTestRuns({ monitorId: overdue.id })).toHaveLength(1);
    const inactive = await other.createMonitor(input);
    await shops.uninstall(otherId);
    await store.schedule();
    expect(await db.testRun.count({ where: { shopId: otherId, monitorId: inactive.id } })).toBe(0);
    await shops.markInstalled(otherId, '');
    expect((await other.getMonitor(inactive.id))?.enabled).toBe(false);
  });
  it('resets cadence when re-enabled and serializes concurrent manual triggers', async () => {
    const monitor = await service.createMonitor({ ...input, enabled: false });
    await service.updateMonitor(monitor.id, { version: 1, enabled: true, frequency: 'DAILY' });
    expect(
      (await db.monitor.findUniqueOrThrow({ where: { id: monitor.id } })).nextRunAt.getTime(),
    ).toBeGreaterThan(Date.now() + 86300000);
    const results = await Promise.allSettled([
      service.createTestRun({ monitorId: monitor.id }),
      service.createTestRun({ monitorId: monitor.id }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await service.listTestRuns({ monitorId: monitor.id })).toHaveLength(1);
  });
  it('isolates opt-in settings, prevents stale writes, and cancels queued mail on change', async () => {
    await service.updateNotificationSettings({
      email: 'owner@example.com',
      enabled: true,
      recoveryEnabled: true,
      version: 0,
    });
    expect(await other.getNotificationSettings()).toBeNull();
    const results = await Promise.allSettled([
      service.updateNotificationSettings({
        email: 'one@example.com',
        enabled: true,
        recoveryEnabled: true,
        version: 1,
      }),
      service.updateNotificationSettings({
        email: 'two@example.com',
        enabled: true,
        recoveryEnabled: true,
        version: 1,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(
      service.updateNotificationSettings({
        email: 'stale@example.com',
        enabled: true,
        recoveryEnabled: true,
        version: 0,
      }),
    ).rejects.toThrow('CONFLICT');
  });
  it('fences competing delivery claims, applies cooldown, cancels settings changes and cascades tenant data', async () => {
    const monitor = await service.createMonitor(input);
    const run = await service.createTestRun({ monitorId: monitor.id });
    const configKey = 'a'.repeat(64);
    const settings = (await service.getNotificationSettings())!;
    await db.incidentScope.create({ data: { shopId, monitorId: monitor.id, configKey } });
    await db.incident.create({
      data: {
        shopId,
        monitorId: monitor.id,
        configKey,
        fingerprint: 'b'.repeat(64),
        type: 'ADD_TO_CART_FAILURE',
        severity: 'CRITICAL',
        title: 'Failure',
        description: 'Fixture',
        status: 'OPEN',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        lastSeenRunId: run.id,
        lastSeenRunCreatedAt: run.createdAt,
      },
    });
    const email = await db.emailDelivery.create({
      data: {
        shopId,
        runId: run.id,
        monitorId: monitor.id,
        configKey,
        kind: 'FAILURE',
        recipient: settings.email,
        channelVersion: settings.version,
      },
    });
    await expect(
      db.emailDelivery.create({
        data: {
          shopId: otherId,
          runId: run.id,
          monitorId: monitor.id,
          configKey,
          kind: 'FAILURE',
          recipient: 'other@example.com',
          channelVersion: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const claims = await Promise.all([store.claimEmail(), store.claimEmail()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claimed = claims.find((value) => value !== null)!;
    await store.finishEmail({ ...claimed, token: randomUUID() }, 'ACCEPTED');
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: email.id } })).status).toBe(
      'SENDING',
    );
    await store.finishEmail(claimed, 'RETRY');
    expect(await store.claimEmail()).toBeNull();
    expect(await other.listEmailHistory()).toEqual([]);
    await service.updateNotificationSettings({ ...settings, enabled: false });
    expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: email.id } })).status).toBe(
      'CANCELLED',
    );
    await shops.uninstall(shopId);
    await shops.redactUninstalledShop(shopId);
    expect(await db.emailDelivery.count({ where: { shopId } })).toBe(0);
    expect(await db.notificationChannel.count({ where: { shopId } })).toBe(0);
  });
});
