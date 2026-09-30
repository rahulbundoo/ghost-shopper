import { PrismaClient } from '@prisma/client';
import { shopDomainSchema, type ShopProfile } from '@ghostshopper/contracts';
export { createTenantRepositories } from './tenant-repositories.js';
export { PrismaRunStore } from './run-store.js';
export { PrismaArtifactRepository } from './artifacts.js';
export { PrismaAnalysisRepository } from './analysis.js';
export { PrismaAiAnalysisRepository } from './ai.js';

export { PrismaClient } from '@prisma/client';
export type { Shop } from '@prisma/client';

export function createDatabase(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export class ShopRepository {
  constructor(private readonly db: PrismaClient) {}

  // Only call with a domain obtained from Shopify authentication/session storage.
  ensureTenant(authenticatedShop: string) {
    const id = shopDomainSchema.parse(authenticatedShop);
    return this.db.shop.upsert({ where: { id }, create: { id }, update: {} });
  }

  async markInstalled(authenticatedShop: string, scopes: string) {
    const id = shopDomainSchema.parse(authenticatedShop);
    await this.ensureTenant(id);
    await this.db.shop.updateMany({
      where: { id, OR: [{ installedAt: null }, { uninstalledAt: { not: null } }] },
      data: { installedAt: new Date(), uninstalledAt: null },
    });
    return this.db.shop.update({ where: { id }, data: { scopes } });
  }

  saveProfile(authenticatedShop: string, profile: ShopProfile) {
    const id = shopDomainSchema.parse(authenticatedShop);
    if (profile.myshopifyDomain !== id) throw new Error('SHOP_IDENTITY_MISMATCH');
    return this.db.shop.update({
      where: { id },
      data: {
        shopifyId: profile.id,
        name: profile.name,
        storefrontUrl: profile.primaryDomain.url,
        currencyCode: profile.currencyCode,
        syncedAt: new Date(),
      },
    });
  }

  async uninstall(authenticatedShop: string) {
    const id = shopDomainSchema.parse(authenticatedShop);
    await this.db.$transaction([
      this.db.session.deleteMany({ where: { shop: id } }),
      this.db.testRun.updateMany({
        where: { shopId: id, status: { in: ['QUEUED', 'RUNNING', 'COLLECTING', 'ANALYZING'] } },
        data: {
          status: 'CANCELLED',
          outcome: 'CANCELLED',
          finishedAt: new Date(),
          errorCode: 'SHOP_INACTIVE',
          dispatchRequested: false,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      }),
      this.db.shop.updateMany({
        where: { id, uninstalledAt: null },
        data: { uninstalledAt: new Date(), scopes: '' },
      }),
    ]);
  }

  async updateScopes(authenticatedShop: string, scopes: string[]) {
    const id = shopDomainSchema.parse(authenticatedShop);
    const scope = scopes.join(',');
    await this.db.$transaction([
      this.db.shop.updateMany({ where: { id, uninstalledAt: null }, data: { scopes: scope } }),
      this.db.session.updateMany({ where: { shop: id }, data: { scope } }),
    ]);
  }

  // Shopify sends shop/redact after uninstall; a reinstalled shop must be retained.
  async redactUninstalledShop(authenticatedShop: string) {
    const id = shopDomainSchema.parse(authenticatedShop);
    await this.db.shop.deleteMany({ where: { id, uninstalledAt: { not: null } } });
  }
}
