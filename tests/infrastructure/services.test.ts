import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
async function compose(...args: string[]) {
  const { stdout } = await exec('docker', ['compose', '-f', 'docker/compose.yaml', ...args], {
    timeout: 25_000,
  });
  return stdout.trim();
}

describe('local infrastructure (requires pnpm infra:up)', () => {
  it('executes a PostgreSQL query', async () => {
    const result = await compose(
      'exec',
      '-T',
      'postgres',
      'sh',
      '-ec',
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1"',
    );
    expect(result).toBe('1');
  });

  it('responds to Redis and uses the queue-safe eviction policy', async () => {
    expect(await compose('exec', '-T', 'redis', 'redis-cli', 'ping')).toBe('PONG');
    expect(
      await compose(
        'exec',
        '-T',
        'redis',
        'redis-cli',
        '--raw',
        'CONFIG',
        'GET',
        'maxmemory-policy',
      ),
    ).toContain('noeviction');
  });

  it('provisions the private artifact bucket idempotently', async () => {
    const result = await compose('run', '--rm', '--no-deps', 'minio-init');
    expect(result).toContain('Access permission');
    expect(result).toContain('private');
    expect(result).toMatch(/Anonymous:\s+Disabled/);
  });

  it('rejects unauthenticated bucket listing', async () => {
    // This command runs inside MinIO and uses the same bucket variable as Compose.
    const result = await compose(
      'exec',
      '-T',
      'minio',
      'sh',
      '-ec',
      'curl -s -o /dev/null -w "%{http_code}" "http://localhost:9000/$S3_BUCKET"',
    );
    expect(result).toBe('403');
  });
});
