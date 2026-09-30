import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { S3ArtifactStorage } from '../../packages/storage/src/index.js';
import type { StoredArtifact } from '../../packages/domain/src/index.js';
const requests: { method: string; headers: object; body: Buffer }[] = [];
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    requests.push({
      method: request.method ?? '',
      headers: request.headers,
      body: Buffer.concat(chunks),
    });
    response.writeHead(200, { ETag: '"fixture"' }).end();
  });
});
let storage: S3ArtifactStorage;
let endpoint: string;
const id = randomUUID();
const key = `evidence/${'a'.repeat(64)}/${randomUUID()}/1/${id}.json`;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_FAILED');
  endpoint = `http://127.0.0.1:${address.port}`;
  storage = new S3ArtifactStorage({
    endpoint,
    region: 'us-east-1',
    bucket: 'private-fixture',
    accessKeyId: 'fixture-key',
    secretAccessKey: 'fixture-secret',
    forcePathStyle: true,
  });
});
afterAll(async () => {
  storage.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
describe('S3 SDK wire contract (controlled HTTP server, not live S3)', () => {
  it('sends a signed private upload with MIME and cache controls', async () => {
    await storage.put(key, { type: 'CONSOLE', body: Buffer.from('{}'), stepPosition: null });
    expect(requests[0]).toMatchObject({
      method: 'PUT',
      body: Buffer.from('{}'),
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
        authorization: expect.stringContaining('AWS4-HMAC-SHA256') as unknown,
      },
    });
    expect(requests[0]?.headers).not.toHaveProperty('x-amz-acl');
  });
  it('signs short attachment downloads and rejects unavailable artifacts', async () => {
    const artifact = {
      id,
      storageKey: key,
      type: 'CONSOLE',
      status: 'READY',
      mimeType: 'application/json',
      expiresAt: new Date(Date.now() + 3600000),
    } as StoredArtifact;
    const signed = await storage.download(artifact);
    const url = new URL(signed.url);
    expect(url.origin).toBe(endpoint);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('response-content-disposition')).toContain('attachment;');
    await expect(storage.download({ ...artifact, status: 'FAILED' })).rejects.toThrow(
      'ARTIFACT_UNAVAILABLE',
    );
    await expect(storage.download({ ...artifact, expiresAt: new Date(0) })).rejects.toThrow(
      'ARTIFACT_UNAVAILABLE',
    );
    await expect(
      storage.put('../escape', { type: 'CONSOLE', body: Buffer.from('{}'), stepPosition: null }),
    ).rejects.toThrow('INVALID_ARTIFACT_KEY');
  });
});
