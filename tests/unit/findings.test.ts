import { describe, expect, it } from 'vitest';
import {
  analyzeTechnicalRun,
  findingIdentity,
  JOURNEY_ACTIONS,
  type ActionResult,
  type AnalysisInput,
  type TestRun,
  type StepErrorCode,
} from '../../packages/domain/src/index.js';
import { AnalysisDiagnostics } from '../../apps/runner/src/diagnostics.js';
import { analysisInputSchema } from '../../packages/contracts/src/index.js';

function input(): AnalysisInput {
  return {
    diagnostics: [],
    diagnosticsComplete: true,
    journeyOutcome: 'PASSED',
    steps: JOURNEY_ACTIONS.map((action, position) => ({
      action,
      position,
      status: 'PASSED',
      startedAt: new Date(0),
      finishedAt: new Date(10),
      durationMs: 10,
      currentUrl: null,
      errorCode: null,
      errorMessage: null,
    })),
  };
}
function failed(position: number, errorCode: StepErrorCode): AnalysisInput {
  const data = input();
  return {
    ...data,
    journeyOutcome: 'FAILED',
    steps: data.steps.map((step): ActionResult =>
      step.position < position
        ? step
        : {
            ...step,
            status: step.position === position ? 'FAILED' : 'SKIPPED',
            errorCode: step.position === position ? errorCode : 'PREVIOUS_STEP_FAILED',
            errorMessage: 'safe error',
          },
    ),
  };
}
describe('technical-v1 deterministic findings', () => {
  it('scores a complete clean journey at 100 with no findings', () => {
    expect(analyzeTechnicalRun(input())).toMatchObject({
      complete: true,
      score: 100,
      outcome: 'PASSED',
      findings: [],
      rulesVersion: 'technical-v1',
    });
  });
  it.each([
    [0, 'PAGE_UNAVAILABLE', 'HIGH', 60],
    [1, 'PRODUCT_NOT_FOUND', 'HIGH', 60],
    [3, 'VARIANT_UNAVAILABLE', 'HIGH', 60],
    [3, 'VARIANT_SELECTOR_FAILURE', 'HIGH', 60],
    [4, 'ADD_TO_CART_FAILURE', 'CRITICAL', 0],
    [5, 'CART_FAILURE', 'CRITICAL', 0],
    [6, 'CHECKOUT_FAILURE', 'CRITICAL', 0],
  ] as const)(
    'explains %s/%s without findings for skipped actions',
    (position, code, severity, score) => {
      const result = analyzeTechnicalRun(failed(position, code));
      expect(result).toMatchObject({ score, outcome: 'FAILED' });
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({ type: code, severity, stepPosition: position });
    },
  );
  it('maps timeout to the failing semantic action without claiming a root cause', () => {
    const result = analyzeTechnicalRun(failed(4, 'ACTION_TIMEOUT'));
    expect(result.findings[0]).toMatchObject({ type: 'ADD_TO_CART_FAILURE', severity: 'CRITICAL' });
    expect(result.findings[0]?.description).toContain('time limit');
  });
  it.each(['UNSAFE_NAVIGATION', 'RUN_ABORTED'] as const)(
    'does not blame the shop for %s',
    (code) => {
      expect(analyzeTechnicalRun(failed(4, code))).toMatchObject({
        score: null,
        complete: false,
        outcome: 'FAILED',
        findings: [],
      });
    },
  );
  it('deduplicates repeated diagnostics, counts occurrences and charges once per type', () => {
    const result = analyzeTechnicalRun({
      ...input(),
      diagnostics: [
        ...Array.from({ length: 100 }, () => ({
          kind: 'JS_ERROR' as const,
          stepPosition: 0,
          resourceType: null,
        })),
        { kind: 'JS_ERROR', stepPosition: 2, resourceType: null },
        { kind: 'HTTP_ERROR', stepPosition: 2, resourceType: 'image' },
        { kind: 'HTTP_ERROR', stepPosition: 2, resourceType: 'fetch' },
      ],
    });
    expect(result).toMatchObject({ score: 65, outcome: 'WARNING' });
    expect(result.findings).toHaveLength(4);
    expect(result.findings[0]).toMatchObject({ type: 'JS_ERROR', occurrences: 100 });
    expect(result.findings.some((f) => f.type === 'BROKEN_IMAGE' && f.severity === 'LOW')).toBe(
      true,
    );
  });
  it('uses explicit page-action timing thresholds, not cart duration or Web Vital claims', () => {
    const data = input();
    const slow = (position: number, durationMs: number) =>
      analyzeTechnicalRun({
        ...data,
        steps: data.steps.map((s) =>
          s.position === position ? { ...s, durationMs, finishedAt: new Date(durationMs) } : s,
        ),
      });
    expect(slow(0, 4999).findings).toHaveLength(0);
    expect(slow(0, 5000)).toMatchObject({ score: 95, outcome: 'WARNING' });
    expect(slow(4, 5000).findings).toHaveLength(0);
  });
  it('never presents missing/truncated data as a perfect score', () => {
    expect(analyzeTechnicalRun({ ...input(), steps: [] })).toMatchObject({
      score: null,
      complete: false,
      outcome: 'WARNING',
    });
    expect(analyzeTechnicalRun({ ...input(), diagnosticsComplete: false }).score).toBeNull();
    expect(analyzeTechnicalRun({ ...input(), journeyOutcome: 'WARNING' }).score).toBeNull();
    expect(
      analyzeTechnicalRun({
        ...input(),
        steps: input().steps.map((step) => ({
          ...step,
          status: 'SKIPPED',
          errorCode: 'PREVIOUS_STEP_FAILED',
          errorMessage: 'skipped',
        })),
      }).score,
    ).toBeNull();
    expect(analyzeTechnicalRun({ ...input(), journeyOutcome: 'FAILED' }).score).toBeNull();
  });
  it('keeps fingerprints stable across runs and prose but isolates tenant, monitor, device and product', () => {
    const run = {
      id: 'run-1',
      shopId: 'a',
      monitorId: 'm',
      scenario: 'PURCHASE_JOURNEY',
      device: 'DESKTOP',
      productId: 'p',
      variantId: null,
    } as TestRun;
    const finding = { type: 'JS_ERROR' as const, stepPosition: 0 };
    const key = findingIdentity(run, finding);
    expect(findingIdentity({ ...run, id: 'run-2', attemptCount: 3 }, finding)).toBe(key);
    for (const change of [
      { shopId: 'b' },
      { monitorId: 'n' },
      { device: 'MOBILE' as const },
      { productId: 'q' },
      { variantId: 'v' },
    ])
      expect(findingIdentity({ ...run, ...change }, finding)).not.toBe(key);
    expect(findingIdentity(run, { ...finding, stepPosition: 1 })).not.toBe(key);
  });
  it('validates bounded input and rejects duplicate steps', () => {
    expect(analysisInputSchema.safeParse(input()).success).toBe(true);
    expect(
      analysisInputSchema.safeParse({ ...input(), steps: [input().steps[0], input().steps[0]] })
        .success,
    ).toBe(false);
    expect(
      analysisInputSchema.safeParse({
        ...input(),
        diagnostics: Array(401).fill({ kind: 'JS_ERROR', stepPosition: 0, resourceType: null }),
      }).success,
    ).toBe(false);
  });
});

describe('diagnostic evidence adapter', () => {
  const body = (events: object[], dropped = 0) =>
    Buffer.from(JSON.stringify({ version: 1, events, dropped }));
  it('ignores console logging and policy-blocked transport failures', () => {
    const data = new AnalysisDiagnostics();
    data.capture({
      type: 'CONSOLE',
      stepPosition: null,
      body: body([
        { kind: 'error', stepPosition: 0 },
        { kind: 'pageerror', stepPosition: 1 },
      ]),
    });
    data.capture({
      type: 'NETWORK',
      stepPosition: null,
      body: body([
        { kind: 'REQUEST_FAILED', stepPosition: 0 },
        { kind: 'HTTP_ERROR', status: 404, stepPosition: 1, resourceType: 'image' },
      ]),
    });
    expect(data.complete).toBe(true);
    expect(data.events).toEqual([
      { kind: 'JS_ERROR', stepPosition: 1, resourceType: null },
      { kind: 'HTTP_ERROR', stepPosition: 1, resourceType: 'image' },
    ]);
  });
  it('marks malformed, dropped, duplicate and missing exports incomplete', () => {
    for (const payload of [Buffer.from('invalid'), body([], 1), Buffer.alloc(1024 * 1024 + 1)]) {
      const data = new AnalysisDiagnostics();
      data.capture({ type: 'CONSOLE', stepPosition: null, body: payload });
      data.capture({ type: 'NETWORK', stepPosition: null, body: body([]) });
      expect(data.complete).toBe(false);
    }
    const data = new AnalysisDiagnostics();
    expect(data.complete).toBe(false);
    for (const type of ['CONSOLE', 'NETWORK', 'CONSOLE'] as const)
      data.capture({ type, stepPosition: null, body: body([]) });
    expect(data.complete).toBe(false);
  });
  it('retains observed findings but marks capture failures incomplete', () => {
    const data = new AnalysisDiagnostics();
    data.capture({
      type: 'CONSOLE',
      stepPosition: null,
      body: body([{ kind: 'pageerror', stepPosition: 0 }]),
    });
    data.capture({ type: 'NETWORK', stepPosition: null, body: body([]) });
    data.capture({
      type: 'METADATA',
      stepPosition: null,
      body: Buffer.from(JSON.stringify({ version: 1, captureErrors: ['TRACE_CAPTURE_FAILED'] })),
    });
    expect(data.complete).toBe(false);
    expect(data.events).toHaveLength(1);
  });
});
