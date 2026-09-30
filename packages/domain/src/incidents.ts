import type { TestRun } from './index.js';
import type { AnalysisResult, FindingType, Severity } from './findings.js';

export const INCIDENT_STATUSES = ['OPEN', 'RESOLVED'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export interface ObservationOrder {
  readonly createdAt: Date;
  readonly id: string;
}
/** Request order is stable across retries and independent of worker completion order. */
export function isLaterObservation(a: ObservationOrder, b: ObservationOrder | null): boolean {
  return (
    b === null ||
    a.createdAt.getTime() > b.createdAt.getTime() ||
    (a.createdAt.getTime() === b.createdAt.getTime() && a.id > b.id)
  );
}
export function canResolveIncidents(
  analysis: Pick<AnalysisResult, 'complete' | 'outcome' | 'findings'>,
): boolean {
  return analysis.complete && analysis.outcome === 'PASSED' && analysis.findings.length === 0;
}
export function incidentScopeIdentity(run: TestRun, rulesVersion: string): string {
  return JSON.stringify([
    'incident-scope-v1',
    run.shopId,
    run.monitorId,
    run.scenario,
    run.device,
    run.productId,
    run.variantId,
    rulesVersion,
  ]);
}
export interface Incident {
  readonly id: string;
  readonly shopId: string;
  readonly monitorId: string;
  readonly configKey: string;
  readonly fingerprint: string;
  readonly type: FindingType;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly status: IncidentStatus;
  readonly occurrenceCount: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly lastSeenRunId: string;
  readonly lastSeenRunCreatedAt: Date;
  readonly resolvedAt: Date | null;
  readonly resolvedRunId: string | null;
}
export interface IncidentOccurrence {
  readonly id: string;
  readonly shopId: string;
  readonly incidentId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly findingId: string;
  readonly createdAt: Date;
}
