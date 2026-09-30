import '@shopify/shopify-app-react-router/adapters/node';
import {
  ApiVersion,
  AppDistribution,
  LogSeverity,
  shopifyApp,
  type ShopifyApp,
} from '@shopify/shopify-app-react-router/server';
import type { SessionStorage } from '@shopify/shopify-app-session-storage';
import { SHOPIFY_SCOPES, type ShopifyConfig } from '@ghostshopper/config';
import type { ShopRepository } from '@ghostshopper/database';

// Pin a supported stable version explicitly; update the webhook TOML in the same change.
export const SHOPIFY_API_VERSION = ApiVersion.July26;
type ApplicationConfiguration = {
  apiKey: string;
  apiSecretKey: string;
  appUrl: string;
  apiVersion: ApiVersion;
  sessionStorage: SessionStorage;
  distribution: AppDistribution.AppStore;
  future: { expiringOfflineAccessTokens: true };
};
export type ShopifyApplication = ShopifyApp<ApplicationConfiguration>;
export function createShopifyApplication(
  config: ShopifyConfig,
  storage: SessionStorage,
  shops: Pick<ShopRepository, 'markInstalled'>,
): ShopifyApplication {
  return shopifyApp({
    apiKey: config.apiKey,
    apiSecretKey: config.apiSecretKey,
    appUrl: config.appUrl,
    apiVersion: SHOPIFY_API_VERSION,
    scopes: SHOPIFY_SCOPES,
    authPathPrefix: '/auth',
    sessionStorage: storage,
    distribution: AppDistribution.AppStore,
    useOnlineTokens: false,
    future: { expiringOfflineAccessTokens: true },
    // SDK diagnostics can contain request details; keep logs structured and omit their text.
    logger: {
      level: LogSeverity.Warning,
      log: (severity) =>
        console.info(
          JSON.stringify({
            level: severity === LogSeverity.Error ? 'error' : 'warn',
            service: 'web',
            event: 'shopify.sdk',
          }),
        ),
    },
    hooks: {
      afterAuth: async ({ session }) => {
        await shops.markInstalled(session.shop, session.scope ?? '');
      },
    },
  });
}
