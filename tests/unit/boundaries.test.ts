import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
async function restrictedImports(filePath: string, source: string) {
  const results = await eslint.lintText(source, { filePath });
  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === 'no-restricted-imports'),
  );
}

describe('architectural import boundaries', () => {
  it.each([
    '@prisma/client',
    '@ghostshopper/database',
    '@shopify/shopify-api',
    'bullmq',
    '@ghostshopper/ai',
    'openai',
  ])('blocks %s in application use cases', async (name) => {
    expect(
      await restrictedImports('packages/application/src/index.ts', `import '${name}';`),
    ).toHaveLength(1);
  });
  it.each([
    '@prisma/client',
    'node:fs',
    'react',
    'bullmq',
    '@ghostshopper/database',
    '@ghostshopper/ai',
    'openai',
  ])('blocks %s in the domain', async (name) => {
    expect(
      await restrictedImports('packages/domain/src/index.ts', `import '${name}';`),
    ).toHaveLength(1);
  });

  it('allows local domain modules', async () => {
    expect(
      await restrictedImports('packages/domain/src/index.ts', "import './rules.js';"),
    ).toHaveLength(0);
  });

  it.each(['playwright', 'playwright-core', '@playwright/test', '@ghostshopper/browser'])(
    'blocks %s in the web application',
    async (name) => {
      expect(
        await restrictedImports('apps/web/app/routes/auth.tsx', `import '${name}';`),
      ).toHaveLength(1);
    },
  );

  it('allows the runner to use browser automation', async () => {
    expect(
      await restrictedImports('apps/runner/src/index.ts', "import 'playwright';"),
    ).toHaveLength(0);
  });
});
