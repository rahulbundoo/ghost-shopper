import { reactRouter } from '@react-router/dev/vite';
import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => {
  const envDir = resolve(import.meta.dirname, '../..');
  const environment = loadEnv(mode, envDir, '');
  for (const [key, value] of Object.entries(environment)) process.env[key] ??= value;
  const appUrl = process.env.SHOPIFY_APP_URL;
  const host = appUrl ? new URL(appUrl).hostname : 'localhost';
  return {
    envDir,
    plugins: [reactRouter()],
    server: {
      host: '127.0.0.1',
      port: Number(process.env.PORT ?? 3000),
      strictPort: true,
      allowedHosts: [host],
      ...(host !== 'localhost' && host !== '127.0.0.1'
        ? {
            hmr: { protocol: 'wss', host, clientPort: 443 },
          }
        : {}),
    },
    // Keep server adapters in their workspace packages so Prisma resolves its generated client.
    ssr: {
      external: [
        '@ghostshopper/storage',
        '@ghostshopper/queue',
        '@ghostshopper/observability',
        '@ghostshopper/application',
        '@ghostshopper/domain',
        '@ghostshopper/config',
        '@ghostshopper/contracts',
        '@ghostshopper/database',
        '@ghostshopper/shopify',
      ],
    },
    build: { assetsInlineLimit: 0 },
  };
});
