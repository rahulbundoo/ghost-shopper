import { describe, expect, it, vi } from 'vitest';
import { createEvidenceRecorder } from '../../apps/runner/src/artifacts.js';
import { readStorageConfig } from '../../packages/config/src/index.js';
import type { RunClaim } from '../../packages/application/src/index.js';
import { PrismaArtifactRepository, type PrismaClient } from '../../packages/database/src/index.js';

const claim = {
  run: { id: '57e735d9-220b-4be1-8fda-fda1c7a71ab5', shopId: 'fixture.myshopify.com' },
  token: 'ed0dcc62-60ac-4a2e-a49f-44950e3bb033',
  attempt: 1,
} as RunClaim;
const evidence = {
  type: 'CONSOLE' as const,
  body: new TextEncoder().encode('{}'),
  stepPosition: null,
};
function fixture() {
  const repository = {
    reserve: vi.fn().mockResolvedValue(true),
    finish: vi.fn().mockResolvedValue(true),
  };
  const storage = { put: vi.fn().mockResolvedValue(undefined), download: vi.fn() };
  const log = vi.fn();
  return { repository, storage, log, record: createEvidenceRecorder(repository, storage, 7, log) };
}
describe('evidence upload coordination', () => {
  it('reserves metadata before uploading and only then acknowledges readiness', async () => {
    const f = fixture();
    await f.record(claim, evidence);
    expect(f.repository.reserve).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({
        type: 'CONSOLE',
        sizeBytes: 2,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
      }),
    );
    expect(f.repository.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      f.storage.put.mock.invocationCallOrder[0]!,
    );
    expect(f.storage.put.mock.invocationCallOrder[0]).toBeLessThan(
      f.repository.finish.mock.invocationCallOrder[0]!,
    );
    expect(f.repository.finish).toHaveBeenCalledWith(claim, expect.any(String), true);
  });
  it('does not upload after lease rejection', async () => {
    const f = fixture();
    f.repository.reserve.mockResolvedValue(false);
    await expect(f.record(claim, evidence)).rejects.toThrow('ARTIFACT_LEASE_LOST');
    expect(f.storage.put).not.toHaveBeenCalled();
  });
  it('records failed uploads without leaking provider errors', async () => {
    const f = fixture();
    f.storage.put.mockRejectedValue(new Error('secret access key'));
    await expect(f.record(claim, evidence)).rejects.toThrow('ARTIFACT_UPLOAD_FAILED');
    expect(f.repository.finish).toHaveBeenCalledWith(claim, expect.any(String), false);
    expect(JSON.stringify(f.log.mock.calls)).not.toContain('secret');
  });
  it('does not report ready if ownership changed after upload', async () => {
    const f = fixture();
    f.repository.finish.mockResolvedValue(false);
    await expect(f.record(claim, evidence)).rejects.toThrow('ARTIFACT_LEASE_LOST');
    expect(f.log).not.toHaveBeenCalled();
  });
  it('fences artifact finalization by tenant, attempt, lease and pending status', async () => {
    const tx = {
      testRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      artifact: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = {
      $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaClient;
    const repository = new PrismaArtifactRepository(db);
    expect(await repository.finish(claim, claim.run.id, true)).toBe(true);
    expect(tx.testRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopId: claim.run.shopId,
          id: claim.run.id,
          attemptCount: 1,
          leaseToken: claim.token,
        }) as unknown,
      }),
    );
    expect(tx.artifact.updateMany).toHaveBeenCalledWith({
      where: {
        id: claim.run.id,
        shopId: claim.run.shopId,
        runId: claim.run.id,
        attempt: 1,
        status: 'PENDING',
      },
      data: { status: 'READY', errorCode: null },
    });
    tx.testRun.updateMany.mockResolvedValue({ count: 0 });
    tx.artifact.updateMany.mockClear();
    expect(await repository.finish(claim, claim.run.id, true)).toBe(false);
    expect(tx.artifact.updateMany).not.toHaveBeenCalled();
  });
});
describe('storage environment validation', () => {
  const env = {
    S3_ENDPOINT: 'https://s3.example',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'private-artifacts',
    S3_ACCESS_KEY_ID: 'key',
    S3_SECRET_ACCESS_KEY: 'secret',
  };
  it('has bounded retention and explicit path-style parsing', () => {
    expect(readStorageConfig(env)).toMatchObject({ retentionDays: 7, forcePathStyle: true });
    expect(readStorageConfig({ ...env, S3_FORCE_PATH_STYLE: 'false' }).forcePathStyle).toBe(false);
    expect(() => readStorageConfig({ ...env, ARTIFACT_RETENTION_DAYS: '31' })).toThrow();
  });
  it.each([
    'http://remote.example',
    'https://user:secret@s3.example',
    'https://s3.example?key=secret',
  ])('rejects unsafe endpoint %s', (url) => {
    expect(() => readStorageConfig({ ...env, S3_ENDPOINT: url })).toThrow('setup is incomplete');
  });
  it('allows native loopback storage in development only', () => {
    expect(readStorageConfig({ ...env, S3_ENDPOINT: 'http://127.0.0.1:9000' })).toHaveProperty(
      'endpoint',
    );
    expect(() =>
      readStorageConfig({ ...env, NODE_ENV: 'production', S3_ENDPOINT: 'http://127.0.0.1:9000' }),
    ).toThrow();
  });
});
