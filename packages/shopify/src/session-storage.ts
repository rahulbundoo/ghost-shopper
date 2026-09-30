import type { Session } from '@shopify/shopify-api';
import type { SessionStorage } from '@shopify/shopify-app-session-storage';
import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';
import { type PrismaClient, ShopRepository } from '@ghostshopper/database';
import { shopDomainSchema } from '@ghostshopper/contracts';

// Instantiate the official adapter only when an authenticated flow needs storage.
// Invalid signatures and public pages never need a database connection.
export class TenantSessionStorage implements SessionStorage {
  private adapter: PrismaSessionStorage<PrismaClient> | undefined;
  private readonly shops: ShopRepository;
  constructor(private readonly db: PrismaClient) {
    this.shops = new ShopRepository(db);
  }
  private storage() {
    return (this.adapter ??= new PrismaSessionStorage(this.db, {
      connectionRetries: 1,
      connectionRetryIntervalMs: 0,
    }));
  }
  async storeSession(session: Session): Promise<boolean> {
    const shop = shopDomainSchema.parse(session.shop);
    // Phase 1 stores offline app sessions only. Binding the ID to its tenant also
    // closes the race between the existing-record check and the adapter's upsert.
    if (session.isOnline || session.id !== `offline_${shop}`) {
      throw new Error('SESSION_TENANT_MISMATCH');
    }
    const previous = await this.db.session.findUnique({
      where: { id: session.id },
      select: { shop: true },
    });
    if (previous && previous.shop !== shop) throw new Error('SESSION_TENANT_MISMATCH');
    await this.shops.ensureTenant(shop);
    return this.storage().storeSession(session);
  }
  loadSession(id: string) {
    return this.storage().loadSession(id);
  }
  async deleteSession(id: string): Promise<boolean> {
    // Unlike the upstream single-delete method, database failures must not be swallowed.
    await this.db.session.deleteMany({ where: { id } });
    return true;
  }
  async deleteSessions(ids: string[]): Promise<boolean> {
    await this.db.session.deleteMany({ where: { id: { in: ids } } });
    return true;
  }
  findSessionsByShop(shop: string) {
    return this.storage().findSessionsByShop(shopDomainSchema.parse(shop));
  }
}
