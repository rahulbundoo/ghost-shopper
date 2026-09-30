import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);

describe('compiled foundation', () => {
  it.each(['runner'])('starts the compiled %s application', async (service) => {
    const { stdout, stderr } = await exec(
      process.execPath,
      [resolve('apps', service, 'dist/index.js'), '--check'],
      { timeout: 10_000 },
    );
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toMatchObject({
      level: 'info',
      service,
      event: 'runner.modules.ready',
    });
  });

  it('loads every package through its declared ESM export', async () => {
    const packages = await readdir('packages', { withFileTypes: true });
    for (const directory of packages.filter((entry) => entry.isDirectory())) {
      const root = resolve('packages', directory.name);
      const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
        exports: { '.': { import: string; types: string } };
        dependencies?: Record<string, string>;
      };
      const entry = manifest.exports['.'];
      await expect(import(pathToFileURL(resolve(root, entry.import)).href)).resolves.toBeDefined();
      await expect(readFile(resolve(root, entry.types), 'utf8')).resolves.toContain('export');
      if (directory.name === 'domain') {
        expect(Object.keys(manifest.dependencies ?? {})).toHaveLength(0);
      }
    }
  });
});
