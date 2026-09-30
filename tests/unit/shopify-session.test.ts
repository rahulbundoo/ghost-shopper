import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../packages/database/src/index.js';
import { Session, TenantSessionStorage } from '../../packages/shopify/src/index.js';

// Unreachable database proves rejected sessions cannot reach persistence.
const db = createDatabase('postgresql://unused:unused@127.0.0.1:1/unused');
const storage = new TenantSessionStorage(db);
afterAll(async () => db.$disconnect());

describe('offline session tenant boundary', () => {
  it('rejects cross-tenant IDs before any lookup or write', async () => {
    const session = new Session({
      id: 'offline_other.myshopify.com',
      shop: 'demo.myshopify.com',
      state: '',
      isOnline: false,
    });
    await expect(storage.storeSession(session)).rejects.toThrow('SESSION_TENANT_MISMATCH');
  });
  it('does not persist online user sessions in the offline-only shell', async () => {
    const session = new Session({
      id: 'offline_demo.myshopify.com',
      shop: 'demo.myshopify.com',
      state: '',
      isOnline: true,
    });
    await expect(storage.storeSession(session)).rejects.toThrow('SESSION_TENANT_MISMATCH');
  });
});
