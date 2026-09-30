import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDatabase, ShopRepository } from '../../packages/database/src/index.js';
import { TenantSessionStorage } from '../../packages/shopify/src/session-storage.js';
import { Session } from '../../packages/shopify/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    'TEST_DATABASE_URL must point to a migrated, dedicated PostgreSQL test database.',
  );
const db = createDatabase(databaseUrl);
const shops = new ShopRepository(db);
const storage = new TenantSessionStorage(db);
const suffix = randomUUID();
const shopA = `phase1-a-${suffix}.myshopify.com`;
const shopB = `phase1-b-${suffix}.myshopify.com`;
function session(shop: string) {
  const value = new Session({ id: `offline_${shop}`, shop, state: 'test-state', isOnline: false });
  value.accessToken = 'test-access-token';
  value.refreshToken = 'test-refresh-token';
  value.expires = new Date('2030-01-01T00:00:00Z');
  value.refreshTokenExpires = new Date('2030-02-01T00:00:00Z');
  return value;
}
beforeAll(async () => {
  await db.$connect();
});
afterAll(async () => {
  // Only remove the two tenants created by this suite; never clear a shared table.
  await db.shop.deleteMany({ where: { id: { in: [shopA, shopB] } } });
  await db.$disconnect();
});
describe('PostgreSQL Shopify lifecycle and isolation', () => {
  it('round-trips offline and refresh tokens using the official adapter', async () => {
    await storage.storeSession(session(shopA));
    await storage.storeSession(session(shopB));
    const reloaded = await new TenantSessionStorage(db).loadSession(`offline_${shopA}`);
    expect(reloaded?.shop).toBe(shopA);
    expect(reloaded?.accessToken).toBe('test-access-token');
    expect(reloaded?.refreshToken).toBe('test-refresh-token');
    expect(reloaded?.refreshTokenExpires?.toISOString()).toBe('2030-02-01T00:00:00.000Z');
  });
  it('prevents an existing session ID moving to another tenant', async () => {
    const wrong = new Session({ id: `offline_${shopA}`, shop: shopB, state: '', isOnline: false });
    await expect(storage.storeSession(wrong)).rejects.toThrow('SESSION_TENANT_MISMATCH');
  });
  it('persists shop identity and scope updates only for the authenticated tenant', async () => {
    await shops.markInstalled(shopA, '');
    const profile = {
      id: 'gid://shopify/Shop/123',
      name: 'Phase 1 test shop',
      myshopifyDomain: shopA,
      currencyCode: 'USD',
      primaryDomain: { url: `https://${shopA}` },
    };
    const saved = await shops.saveProfile(shopA, profile);
    expect(saved.name).toBe(profile.name);
    expect(saved.syncedAt).not.toBeNull();
    expect(() => shops.saveProfile(shopB, profile)).toThrow('SHOP_IDENTITY_MISMATCH');
    await shops.updateScopes(shopA, ['test_scope']);
    expect((await storage.loadSession(`offline_${shopA}`))?.scope).toBe('test_scope');
    expect((await storage.loadSession(`offline_${shopB}`))?.scope).not.toBe('test_scope');
    expect((await db.shop.findUniqueOrThrow({ where: { id: shopB } })).name).toBeNull();
  });
  it('removes only the uninstalled tenant sessions and supports duplicate delivery', async () => {
    await shops.markInstalled(shopA, '');
    await shops.markInstalled(shopB, '');
    await shops.uninstall(shopA);
    await shops.uninstall(shopA);
    expect(await storage.loadSession(`offline_${shopA}`)).toBeUndefined();
    expect((await storage.loadSession(`offline_${shopB}`))?.shop).toBe(shopB);
    expect(
      (await db.shop.findUniqueOrThrow({ where: { id: shopA } })).uninstalledAt,
    ).not.toBeNull();
  });
  it('retains a reinstalled shop when an old privacy redaction arrives', async () => {
    await storage.storeSession(session(shopA));
    await shops.markInstalled(shopA, '');
    await shops.redactUninstalledShop(shopA);
    expect(await db.shop.findUnique({ where: { id: shopA } })).not.toBeNull();
    await shops.uninstall(shopA);
    await shops.redactUninstalledShop(shopA);
    expect(await db.shop.findUnique({ where: { id: shopA } })).toBeNull();
    expect(await db.shop.findUnique({ where: { id: shopB } })).not.toBeNull();
  });
});
