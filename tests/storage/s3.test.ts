import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3ArtifactStorage } from '../../packages/storage/src/index.js';
import { readStorageConfig } from '../../packages/config/src/index.js';
import type { StoredArtifact } from '../../packages/domain/src/index.js';
const config = readStorageConfig(
  Object.fromEntries(
    Object.entries(process.env)
      .filter(([key]) => key.startsWith('TEST_S3_'))
      .map(([key, value]) => [key.slice(5), value]),
  ),
);
const storage = new S3ArtifactStorage(config);
const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: config.forcePathStyle,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
});
describe('dedicated private S3 service', () => {
  it('uploads, rejects anonymous reads, and supports a signed download', async () => {
    const id = randomUUID();
    const key = `evidence/${'a'.repeat(64)}/${randomUUID()}/1/${id}.json`;
    try {
      await storage.put(key, {
        type: 'CONSOLE',
        body: Buffer.from('{"test":true}'),
        stepPosition: null,
      });
      const signed = await storage.download({
        id,
        storageKey: key,
        type: 'CONSOLE',
        status: 'READY',
        mimeType: 'application/json',
        expiresAt: new Date(Date.now() + 3600000),
      } as StoredArtifact);
      const anonymous = new URL(signed.url);
      anonymous.search = '';
      expect((await fetch(anonymous, { signal: AbortSignal.timeout(5000) })).status).toBe(403);
      const response = await fetch(signed.url, { signal: AbortSignal.timeout(5000) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ test: true });
    } finally {
      // Exact random key created by this test only. Never clear a bucket or prefix.
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(5000),
      });
      storage.close();
      client.destroy();
    }
  });
});
