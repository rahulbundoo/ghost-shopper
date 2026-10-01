import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Unit/database suites exercise source consistently, avoiding duplicate Error class
// identities when a source module imports another package's compiled export.
const sourceAliases = Object.fromEntries(
  [
    'domain',
    'contracts',
    'application',
    'database',
    'queue',
    'observability',
    'config',
    'browser',
    'storage',
    'ai',
  ].map((name) => [
    `@ghostshopper/${name}`,
    resolve(import.meta.dirname, `packages/${name}/src/index.ts`),
  ]),
);

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'storage',
          environment: 'node',
          include: ['tests/storage/**/*.test.ts'],
          testTimeout: 15000,
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'browser',
          environment: 'node',
          include: ['tests/browser/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'queue',
          environment: 'node',
          include: ['tests/queue/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'database',
          // Scheduler tests scan all eligible tenants in this dedicated test database.
          fileParallelism: false,
          environment: 'node',
          include: ['tests/database/**/*.test.ts'],
          testTimeout: 15_000,
        },
      },
      {
        resolve: { alias: sourceAliases },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          // The first boundary test initializes ESLint's TypeScript project service.
          testTimeout: 15_000,
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'infrastructure',
          environment: 'node',
          include: ['tests/infrastructure/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
