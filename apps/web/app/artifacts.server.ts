import { readStorageConfig } from '@ghostshopper/config';
import { S3ArtifactStorage } from '@ghostshopper/storage';
import type { StoredArtifact } from '@ghostshopper/domain';
let storage: S3ArtifactStorage | undefined;
export function artifactDownload(artifact: StoredArtifact) {
  storage ??= new S3ArtifactStorage(readStorageConfig(process.env));
  return storage.download(artifact);
}
