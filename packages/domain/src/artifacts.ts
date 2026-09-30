export const ARTIFACT_TYPES = ['SCREENSHOT', 'TRACE', 'CONSOLE', 'NETWORK', 'METADATA'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export const ARTIFACT_FORMATS: Readonly<
  Record<ArtifactType, { mimeType: string; extension: string }>
> = {
  SCREENSHOT: { mimeType: 'image/png', extension: 'png' },
  TRACE: { mimeType: 'application/zip', extension: 'zip' },
  CONSOLE: { mimeType: 'application/json', extension: 'json' },
  NETWORK: { mimeType: 'application/json', extension: 'json' },
  METADATA: { mimeType: 'application/json', extension: 'json' },
};
export interface CapturedEvidence {
  readonly type: ArtifactType;
  readonly stepPosition: number | null;
  readonly body: Uint8Array;
}
export interface Artifact {
  readonly id: string;
  readonly shopId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly stepId: string | null;
  readonly stepPosition: number | null;
  readonly type: ArtifactType;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly status: 'PENDING' | 'READY' | 'FAILED';
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}
/** Internal only; public listings deliberately omit the object key. */
export interface StoredArtifact extends Artifact {
  readonly storageKey: string;
}
export interface ArtifactReservation {
  readonly id: string;
  readonly type: ArtifactType;
  readonly stepPosition: number | null;
  readonly storageKey: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly expiresAt: Date;
}
