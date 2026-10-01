import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  ShopRepository,
  PrismaRateLimiter,
  PrismaMaintenance,
  createTenantRepositories,
} from '../../packages/database/src/index.js';
import { Session, TenantSessionStorage } from '../../packages/shopify/src/index.js';
import { MonitoringService } from '../../packages/application/src/index.js';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must select a dedicated migrated test database.');
const db = createDatabase(url);
const shop = `hardening-${randomUUID()}.myshopify.com`;
const key = `evidence/${createHash('sha256').update(shop).digest('hex')}/${randomUUID()}/1/${randomUUID()}.json`;
const bucketKey = createHash('sha256').update(`${shop}:write`).digest('hex');
const shops = new ShopRepository(db);
beforeAll(async () => {
  await shops.markInstalled(shop, '');
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: shop } });
    await db.artifactDeletion.deleteMany({ where: { storageKey: key } });
    await db.rateLimitBucket.deleteMany({ where: { key: bucketKey } });
  } finally {
    await db.$disconnect();
  }
});
describe('PostgreSQL production safeguards', () => {
  it('shares a twenty-request budget across concurrent clients and resets the next window', async () => {
    const limiter = new PrismaRateLimiter(db);
    const results = await Promise.all(
      Array.from({ length: 30 }, () => limiter.take(shop, 'write', 20)),
    );
    expect(results.filter(Boolean)).toHaveLength(20);
    await db.rateLimitBucket.update({
      where: { key: bucketKey },
      data: { windowStart: new Date(0) },
    });
    expect(await limiter.take(shop, 'write', 20)).toBe(true);
  });
  it('persists encrypted access/refresh tokens while returning usable SDK sessions', async () => {
    const storage = new TenantSessionStorage(db, 'a1'.repeat(32));
    const session = new Session({
      id: `offline_${shop}`,
      shop,
      state: '',
      isOnline: false,
      accessToken: 'private-access',
      refreshToken: 'private-refresh',
    });
    await storage.storeSession(session);
    const row = await db.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.accessToken).toMatch(/^enc:v1:/);
    expect(row.accessToken).not.toContain('private-access');
    expect(row.refreshToken).toMatch(/^enc:v1:/);
    expect((await storage.loadSession(session.id))?.accessToken).toBe('private-access');
    expect((await storage.findSessionsByShop(shop))[0]?.refreshToken).toBe('private-refresh');
    await expect(
      new TenantSessionStorage(db, 'b2'.repeat(32)).loadSession(session.id),
    ).rejects.toThrow('SESSION_DECRYPTION_FAILED');
    expect(session.accessToken).toBe('private-access');
  });
  it('survives tenant redaction, serializes deletion claims and fences stale acknowledgement', async () => {
    const service = new MonitoringService(createTenantRepositories(db, shop));
    const monitor = await service.createMonitor({
      name: 'Privacy fixture',
      productId: 'gid://shopify/Product/1',
      device: 'DESKTOP',
      frequency: 'DAILY',
    });
    const run = await service.createTestRun({ monitorId: monitor.id });
    await db.artifact.create({
      data: {
        id: randomUUID(),
        shopId: shop,
        runId: run.id,
        attempt: 1,
        type: 'CONSOLE',
        storageKey: key,
        mimeType: 'application/json',
        sizeBytes: 2,
        sha256: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await db.artifactDeletion.create({
      data: { storageKey: key, nextAttemptAt: new Date(Date.now() + 86400000) },
    });
    await shops.uninstall(shop);
    await shops.redactUninstalledShop(shop);
    expect(await db.shop.findUnique({ where: { id: shop } })).toBeNull();
    const intent = await db.artifactDeletion.findUniqueOrThrow({ where: { storageKey: key } });
    expect(intent.nextAttemptAt.getTime()).toBeLessThan(Date.now() + 660000);
    await db.artifactDeletion.update({
      where: { storageKey: key },
      data: { nextAttemptAt: new Date(0) },
    });
    const maintenance = new PrismaMaintenance(db);
    const claims = await Promise.all([maintenance.claimDeletion(), maintenance.claimDeletion()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find((value) => value !== null)!;
    await maintenance.finishDeletion({ ...claim, token: randomUUID() }, true);
    expect(await db.artifactDeletion.count({ where: { storageKey: key } })).toBe(1);
    await maintenance.finishDeletion(claim, true);
    expect(await db.artifactDeletion.count({ where: { storageKey: key } })).toBe(0);
  });
});
