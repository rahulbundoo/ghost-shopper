import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// No fallback URL: deployment must select a database explicitly.
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Configure a dedicated PostgreSQL database in .env.');
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [resolve('packages/database/node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
  { cwd: resolve('packages/database'), env: process.env, stdio: 'inherit' },
);
if (result.error) {
  console.error('Unable to start Prisma migration deployment.');
  process.exit(1);
}
process.exit(result.status ?? 1);
