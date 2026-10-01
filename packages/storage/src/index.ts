import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ArtifactStorage } from '@ghostshopper/application';
import { ARTIFACT_FORMATS, type CapturedEvidence, type StoredArtifact } from '@ghostshopper/domain';

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}
export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
export function assertArtifactKey(key: string): void {
  if (!/^evidence\/[a-f0-9]{64}\/[a-f0-9-]{36}\/[1-3]\/[a-f0-9-]{36}\.(png|zip|json)$/.test(key))
    throw new Error('INVALID_ARTIFACT_KEY');
}
export class S3ArtifactStorage implements ArtifactStorage {
  private readonly client: S3Client;
  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle,
      maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  async put(key: string, evidence: CapturedEvidence): Promise<void> {
    assertArtifactKey(key);
    if (evidence.body.byteLength < 1 || evidence.body.byteLength > MAX_ARTIFACT_BYTES)
      throw new Error('ARTIFACT_SIZE_LIMIT');
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: evidence.body,
          ContentLength: evidence.body.byteLength,
          ContentType: ARTIFACT_FORMATS[evidence.type].mimeType,
          CacheControl: 'private, no-store',
          // No public ACL. Deployment must enforce a private bucket and TLS/encryption.
        }),
        { abortSignal: AbortSignal.timeout(5000) },
      );
    } catch {
      throw new Error('ARTIFACT_UPLOAD_FAILED');
    }
  }
  async download(artifact: StoredArtifact): Promise<{ url: string; expiresAt: Date }> {
    assertArtifactKey(artifact.storageKey);
    const seconds = Math.min(60, Math.floor((artifact.expiresAt.getTime() - Date.now()) / 1000));
    if (artifact.status !== 'READY' || seconds < 1) throw new Error('ARTIFACT_UNAVAILABLE');
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: artifact.storageKey,
        ResponseContentType: artifact.mimeType,
        ResponseCacheControl: 'private, no-store',
        ResponseContentDisposition: `attachment; filename="${artifact.type.toLowerCase()}-${artifact.id}.${ARTIFACT_FORMATS[artifact.type].extension}"`,
      }),
      { expiresIn: seconds },
    );
    return { url, expiresAt: new Date(Date.now() + seconds * 1000) };
  }
  close() {
    this.client.destroy();
  }
  async delete(key: string) {
    assertArtifactKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }), {
        abortSignal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Error('OBJECT_DELETE_FAILED');
    }
  }
}
