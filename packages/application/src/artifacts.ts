import type { ArtifactReservation, CapturedEvidence, StoredArtifact } from '@ghostshopper/domain';
import type { RunClaim } from './run-processing.js';
export interface ArtifactRepository {
  reserve(claim: RunClaim, artifact: ArtifactReservation): Promise<boolean>;
  finish(claim: RunClaim, id: string, ready: boolean): Promise<boolean>;
}
export interface ArtifactStorage {
  put(key: string, evidence: CapturedEvidence): Promise<void>;
  download(artifact: StoredArtifact): Promise<{ url: string; expiresAt: Date }>;
}
export type EvidenceRecorder = (claim: RunClaim, evidence: CapturedEvidence) => Promise<void>;
