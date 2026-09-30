export { createShopifyApplication, SHOPIFY_API_VERSION } from './app.js';
export type { ShopifyApplication } from './app.js';
export { TenantSessionStorage } from './session-storage.js';
export { fetchShopProfile, ShopifyConnectionError, SHOP_QUERY } from './shop-profile.js';
export type { ShopGraphqlClient } from './shop-profile.js';
export { Session } from '@shopify/shopify-api';
export type { SessionStorage } from '@shopify/shopify-app-session-storage';
import { scopesUpdateSchema } from '@ghostshopper/contracts';
export function parseScopeUpdate(payload: unknown): string[] | undefined {
  const parsed = scopesUpdateSchema.safeParse(payload);
  return parsed.success ? parsed.data.current : undefined;
}
