import { JOURNEY_ACTIONS, type ActionResult } from './journey.js';
import type { TestRun } from './index.js';

export const TECHNICAL_FINDING_TYPES = [
  'PAGE_UNAVAILABLE',
  'PRODUCT_NOT_FOUND',
  'BROKEN_IMAGE',
  'VARIANT_UNAVAILABLE',
  'VARIANT_SELECTOR_FAILURE',
  'ADD_TO_CART_FAILURE',
  'CART_FAILURE',
  'CHECKOUT_FAILURE',
  'HTTP_ERROR',
  'JS_ERROR',
  'SLOW_PAGE',
] as const;
export type FindingType = (typeof TECHNICAL_FINDING_TYPES)[number];
export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ANALYSIS_VERSION = 'technical-v1' as const;
export const SLOW_ACTION_MS = 5000;
export const FINDING_SEVERITY: Readonly<Record<FindingType, Severity>> = {
  PAGE_UNAVAILABLE: 'HIGH',
  PRODUCT_NOT_FOUND: 'HIGH',
  BROKEN_IMAGE: 'LOW',
  VARIANT_UNAVAILABLE: 'HIGH',
  VARIANT_SELECTOR_FAILURE: 'HIGH',
  ADD_TO_CART_FAILURE: 'CRITICAL',
  CART_FAILURE: 'CRITICAL',
  CHECKOUT_FAILURE: 'CRITICAL',
  HTTP_ERROR: 'MEDIUM',
  JS_ERROR: 'MEDIUM',
  SLOW_PAGE: 'LOW',
};
const descriptions: Readonly<Record<FindingType, string>> = {
  PAGE_UNAVAILABLE: 'The homepage action could not load the storefront.',
  PRODUCT_NOT_FOUND: 'The configured product could not be discovered or opened.',
  BROKEN_IMAGE: 'An image request returned an HTTP error response.',
  VARIANT_UNAVAILABLE: 'The requested product variant was unavailable.',
  VARIANT_SELECTOR_FAILURE: 'The requested variant could not be selected unambiguously.',
  ADD_TO_CART_FAILURE: 'Adding the selected item to the cart could not be verified.',
  CART_FAILURE: 'The cart could not be verified to contain the selected item.',
  CHECKOUT_FAILURE: 'Checkout initiation could not be verified; no purchase was attempted.',
  HTTP_ERROR: 'A request returned an HTTP status of 400 or greater.',
  JS_ERROR: 'An uncaught JavaScript exception occurred. Exception text is omitted for privacy.',
  SLOW_PAGE:
    'A successful page-opening action took at least 5000 ms. This is action duration, not a Web Vital.',
};
export interface TechnicalDiagnostic {
  readonly kind: 'JS_ERROR' | 'HTTP_ERROR';
  readonly stepPosition: number | null;
  readonly resourceType: string | null;
}
export interface FindingDraft {
  readonly type: FindingType;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly stepPosition: number | null;
  readonly occurrences: number;
  readonly evidenceType: 'SCREENSHOT' | 'CONSOLE' | 'NETWORK';
}
export interface AnalysisInput {
  readonly steps: readonly ActionResult[];
  readonly diagnostics: readonly TechnicalDiagnostic[];
  readonly diagnosticsComplete: boolean;
  readonly journeyOutcome: 'PASSED' | 'WARNING' | 'FAILED';
}
export interface AnalysisResult {
  readonly rulesVersion: string;
  readonly score: number | null;
  readonly complete: boolean;
  readonly outcome: 'PASSED' | 'WARNING' | 'FAILED';
  readonly findings: readonly FindingDraft[];
}
export interface Finding extends FindingDraft {
  readonly id: string;
  readonly shopId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly source: 'DETECTED';
  readonly fingerprint: string;
  readonly stepId: string | null;
  readonly evidenceArtifactId: string | null;
  readonly createdAt: Date;
}
export interface RunAnalysis {
  readonly shopId: string;
  readonly runId: string;
  readonly attempt: number;
  readonly rulesVersion: string;
  readonly score: number | null;
  readonly complete: boolean;
  readonly outcome: 'PASSED' | 'WARNING' | 'FAILED';
  readonly createdAt: Date;
  readonly findings: readonly Finding[];
}
/** Stable identity, not display text, time, run ID or resource query strings. Hash in an adapter. */
export function findingIdentity(
  run: TestRun,
  finding: Pick<FindingDraft, 'type' | 'stepPosition'>,
): string {
  return JSON.stringify([
    'finding-v1',
    run.shopId,
    run.monitorId,
    run.scenario,
    finding.type,
    finding.stepPosition === null ? null : JOURNEY_ACTIONS[finding.stepPosition],
    run.device,
    run.productId,
    run.variantId,
  ]);
}
export function analyzeTechnicalRun(input: AnalysisInput): AnalysisResult {
  const found = new Map<string, FindingDraft>();
  const add = (
    type: FindingType,
    stepPosition: number | null,
    evidenceType: FindingDraft['evidenceType'],
    timeout = false,
  ) => {
    const key = `${type}:${stepPosition}`;
    const previous = found.get(key);
    found.set(key, {
      type,
      severity: FINDING_SEVERITY[type],
      title: type.split('_').join(' '),
      description: descriptions[type] + (timeout ? ' The action exceeded its time limit.' : ''),
      stepPosition,
      occurrences: (previous?.occurrences ?? 0) + 1,
      evidenceType,
    });
  };
  let complete =
    input.diagnosticsComplete &&
    input.journeyOutcome !== 'WARNING' &&
    input.steps.length === JOURNEY_ACTIONS.length &&
    JOURNEY_ACTIONS.every((action, position) =>
      input.steps.some((step) => step.position === position && step.action === action),
    );
  const actionFailures: Record<string, FindingType> = {
    OPEN_HOME: 'PAGE_UNAVAILABLE',
    FIND_PRODUCT: 'PRODUCT_NOT_FOUND',
    OPEN_PRODUCT: 'PRODUCT_NOT_FOUND',
    SELECT_VARIANT: 'VARIANT_SELECTOR_FAILURE',
    ADD_TO_CART: 'ADD_TO_CART_FAILURE',
    OPEN_CART: 'CART_FAILURE',
    BEGIN_CHECKOUT: 'CHECKOUT_FAILURE',
  };
  let encounteredFailure = false;
  for (const step of [...input.steps].sort((a, b) => a.position - b.position)) {
    if (encounteredFailure ? step.status !== 'SKIPPED' : step.status === 'SKIPPED')
      complete = false;
    if (step.status === 'FAILED') encounteredFailure = true;
  }
  if (input.journeyOutcome === 'FAILED' && !encounteredFailure) complete = false;
  for (const step of input.steps) {
    if (step.status === 'FAILED') {
      if (step.errorCode === 'RUN_ABORTED' || step.errorCode === 'UNSAFE_NAVIGATION') {
        complete = false;
        continue;
      }
      const type =
        TECHNICAL_FINDING_TYPES.find((value) => value === step.errorCode) ??
        actionFailures[step.action];
      if (type) add(type, step.position, 'SCREENSHOT', step.errorCode === 'ACTION_TIMEOUT');
    }
    if (
      step.status === 'PASSED' &&
      ['OPEN_HOME', 'OPEN_PRODUCT', 'OPEN_CART'].includes(step.action) &&
      step.durationMs >= SLOW_ACTION_MS
    )
      add('SLOW_PAGE', step.position, 'SCREENSHOT');
  }
  for (const event of input.diagnostics)
    add(
      event.kind === 'HTTP_ERROR' && event.resourceType === 'image' ? 'BROKEN_IMAGE' : event.kind,
      event.stepPosition,
      event.kind === 'JS_ERROR' ? 'CONSOLE' : 'NETWORK',
    );
  const findings = [...found.values()].sort(
    (a, b) => (a.stepPosition ?? -1) - (b.stepPosition ?? -1) || a.type.localeCompare(b.type),
  );
  // Charge once per finding type, not per event: noisy pages cannot inflate penalties.
  const weights: Record<Severity, number> = {
    INFO: 0,
    LOW: 5,
    MEDIUM: 15,
    HIGH: 40,
    CRITICAL: 100,
  };
  const penalty = [...new Set(findings.map((finding) => finding.type))].reduce(
    (sum, type) => sum + weights[FINDING_SEVERITY[type]],
    0,
  );
  const failed =
    input.journeyOutcome === 'FAILED' || input.steps.some((step) => step.status === 'FAILED');
  return {
    rulesVersion: ANALYSIS_VERSION,
    complete,
    score: complete ? Math.max(0, 100 - penalty) : null,
    outcome: failed ? 'FAILED' : findings.length || !complete ? 'WARNING' : 'PASSED',
    findings,
  };
}
