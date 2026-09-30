import type { AiCompletion, JourneyAnalysisInput } from '@ghostshopper/domain';
import type { RunClaim } from './run-processing.js';

export interface AiProvider {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly pricing: {
    readonly input: number;
    readonly cachedInput: number;
    readonly output: number;
  };
  analyzeJourney(input: JourneyAnalysisInput): Promise<AiCompletion>;
}
export interface AiRequestMetadata {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly requestedAt: Date;
  readonly evidenceSteps: readonly number[];
  readonly pricing: AiProvider['pricing'];
}
export interface AiAnalysisRepository {
  /** Durable, one-shot reservation. Null for duplicates, inactive tenants or non-completed runs. */
  begin(claim: RunClaim, metadata: AiRequestMetadata): Promise<string | null>;
  finish(claim: RunClaim, id: string, completion: AiCompletion): Promise<boolean>;
  expire(): Promise<void>;
}
