import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const browserImports = [
  '@ghostshopper/browser',
  '@ghostshopper/browser/*',
  'playwright',
  'playwright/*',
  'playwright-core',
  'playwright-core/*',
  '@playwright/*',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.react-router/**',
      '**/.shopify/**',
      '**/node_modules/**',
      '**/coverage/**',
      '.idea/**',
    ],
  },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?![.]{1,2}/)',
              message:
                'Domain code may only import its own relative modules; infrastructure belongs in adapters.',
            },
            {
              group: ['**/apps/**', '**/packages/**', '../../*'],
              message: 'Do not bypass workspace boundaries with relative imports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/application/src/**/*.ts', 'packages/contracts/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(@prisma/|@shopify/|@ghostshopper/(database|shopify|browser|queue|storage|ai|notifications)|playwright|bullmq|redis|openai|react|node:)',
              message:
                'Application ports and boundary contracts must not depend on infrastructure adapters.',
            },
            {
              group: ['**/apps/**', '**/packages/**', '../../*'],
              message: 'Do not bypass workspace package exports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: browserImports,
              message: 'Browser automation must run asynchronously in the runner.',
            },
            {
              group: ['**/runner/**', '**/browser/src/**'],
              message: 'Do not bypass the runner boundary with relative imports.',
            },
          ],
        },
      ],
    },
  },
  prettier,
  {
    files: ['apps/web/app/**/*.ts', 'apps/web/app/**/*.tsx'],
    rules: {
      // React Router deliberately uses thrown Response objects for redirects/errors.
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'lib', name: 'Response' }] },
      ],
    },
  },
);
