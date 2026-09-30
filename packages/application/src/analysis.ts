import type { AnalysisInput, AnalysisResult } from '@ghostshopper/domain';
import type { RunClaim } from './run-processing.js';
export interface AnalysisRepository {
  save(claim: RunClaim, input: AnalysisInput): Promise<AnalysisResult | null>;
}
