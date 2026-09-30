import type { ActionResult } from './journey.js';
import type { FindingDraft } from './findings.js';

export const EXPERIENCE_FINDING_TYPES = [
  'MOBILE_LAYOUT_ISSUE',
  'UNCLEAR_PRICE',
  'UNCLEAR_SHIPPING',
  'CONFUSING_FLOW',
  'OBSTRUCTED_PURCHASE_ACTION',
] as const;
export type ExperienceFindingType = (typeof EXPERIENCE_FINDING_TYPES)[number];
export const EXPERIENCE_SEVERITY = {
  MOBILE_LAYOUT_ISSUE: 'LOW',
  UNCLEAR_PRICE: 'MEDIUM',
  UNCLEAR_SHIPPING: 'MEDIUM',
  CONFUSING_FLOW: 'MEDIUM',
  OBSTRUCTED_PURCHASE_ACTION: 'HIGH',
} as const;
export interface ExperienceFinding {
  readonly type: ExperienceFindingType;
  readonly severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
  readonly step: number;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly confidence: number;
}
export interface JourneyAnalysis {
  readonly experience: 'GOOD' | 'WARNING' | 'BAD';
  readonly experienceScore: number;
  readonly findings: readonly ExperienceFinding[];
}
export interface JourneyAnalysisInput {
  readonly device: 'DESKTOP' | 'MOBILE';
  readonly steps: readonly Pick<
    ActionResult,
    'position' | 'action' | 'status' | 'durationMs' | 'errorCode'
  >[];
  readonly technicalFindings: readonly Pick<FindingDraft, 'type' | 'severity' | 'stepPosition'>[];
  /** Masked public storefront screenshots only; never checkout or trace data. */
  readonly screenshots: readonly { readonly stepPosition: number; readonly pngBase64: string }[];
}
export interface AiUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}
export interface AiCompletion {
  readonly status: 'SUCCEEDED' | 'FAILED';
  readonly responseAt: Date | null;
  readonly latencyMs: number;
  readonly usage: AiUsage | null;
  /** USD estimate, not a billing ledger. Null means unknown, never free. */
  readonly estimatedCostUsd: string | null;
  readonly result: JourneyAnalysis | null;
  readonly errorCode: string | null;
}
export interface AiAnalysis extends AiCompletion {
  readonly id: string;
  readonly shopId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly source: 'AI_ANALYSIS';
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly requestedAt: Date;
  readonly evidenceSteps: readonly number[];
}
// Pending records have no result or known cost yet.
export type AiAnalysisRecord = Omit<AiAnalysis, 'status' | 'latencyMs'> & {
  readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly latencyMs: number | null;
};
