import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

export function backupConfiguration(env, restore = false) {
  const url = new URL(restore ? (env.RESTORE_DATABASE_URL ?? '') : (env.DATABASE_URL ?? ''));
  const file = env.BACKUP_FILE;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !file || !isAbsolute(file))
    throw new Error('BACKUP_CONFIGURATION_INVALID');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (restore && !/^ghostshopper_restore_[a-z0-9_]+$/.test(database))
    throw new Error('RESTORE_TARGET_REJECTED');
  const ssl = url.searchParams.get('sslmode') ?? 'verify-full';
  if (!['require', 'verify-ca', 'verify-full'].includes(ssl))
    throw new Error('BACKUP_TLS_REQUIRED');
  return {
    file,
    environment: {
      PATH: env.PATH ?? env.Path,
      SystemRoot: env.SystemRoot,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
      PGSSLMODE: ssl,
      ...(env.PGSSLROOTCERT ? { PGSSLROOTCERT: env.PGSSLROOTCERT } : {}),
    },
  };
}
async function main() {
  const restore = process.argv.includes('--restore');
  const { file, environment } = backupConfiguration(process.env, restore);
  if (process.argv.includes('--check')) {
    console.info('Backup configuration valid; no database contacted.');
    return;
  }
  if (restore && !process.argv.includes('--confirm-isolated-restore'))
    throw new Error('RESTORE_CONFIRMATION_REQUIRED');
  // Exclusive creation: never overwrite a backup. Partial files are retained for diagnosis.
  const handle = restore ? null : await open(file, 'wx', 0o600);
  try {
    const args = restore
      ? [
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '--dbname',
          environment.PGDATABASE,
          file,
        ]
      : ['--format=custom', '--no-owner', '--no-acl'];
    const child = spawn(restore ? 'pg_restore' : 'pg_dump', args, {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr.resume(); // Provider diagnostics may contain credentials or connection strings.
    const completion = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('BACKUP_COMMAND_FAILED')),
      );
    });
    if (handle) await Promise.all([pipeline(child.stdout, handle.createWriteStream()), completion]);
    else {
      child.stdout.resume();
      await completion;
    }
    console.info(
      restore
        ? 'Restore completed in isolated target. Verify schema, counts, tenant isolation and application queries before declaring recovery.'
        : 'Backup completed. Encrypt and replicate the archive; verify it with an isolated restore.',
    );
  } finally {
    await handle?.close();
  }
}
if (process.argv[1]?.endsWith('backup.mjs'))
  main().catch(() => {
    console.error(
      'Backup/restore failed. No secrets logged. Any newly created partial archive is retained.',
    );
    process.exitCode = 1;
  });
