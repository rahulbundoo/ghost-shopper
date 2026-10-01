import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
describe('operator command safety without external services', () => {
  it('checks backup configuration without connecting or writing an archive', () => {
    const result = spawnSync(process.execPath, ['scripts/backup.mjs', '--check'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://app:private-password@unused.example/db?sslmode=verify-full',
        BACKUP_FILE: resolve('test-results/never-created.dump'),
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no database contacted');
    expect(result.stdout + result.stderr).not.toContain('private-password');
  });
  it('rejects restoring into an ordinary database before launching pg_restore', () => {
    const result = spawnSync(process.execPath, ['scripts/backup.mjs', '--restore', '--check'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RESTORE_DATABASE_URL:
          'postgresql://app:private-password@unused.example/production?sslmode=verify-full',
        BACKUP_FILE: resolve('test-results/never-created.dump'),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain('private-password');
  });
  it('fails deployed preflight closed without exposing secrets', () => {
    const result = spawnSync(process.execPath, ['scripts/preflight.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DEPLOYMENT_ENV: 'production',
        SESSION_ENCRYPTION_KEY: '',
        SHOPIFY_API_SECRET: 'never-print-this-secret',
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DEPLOYMENT_CONFIGURATION_INVALID');
    expect(result.stdout + result.stderr).not.toContain('never-print-this-secret');
  });
});
