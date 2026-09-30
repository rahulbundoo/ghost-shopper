import type {
  RunStore,
  RunLogger,
  EvidenceRecorder,
  AnalysisRepository,
} from '@ghostshopper/application';
import { AnalysisDiagnostics } from './diagnostics.js';
import { AiEvidence, type RunAiAnalyzer } from './ai.js';
import { runMonitorJobSchema, validate, type RunMonitorJob } from '@ghostshopper/contracts';
import {
  MAX_RUN_ATTEMPTS,
  type ActionResult,
  type AnalysisResult,
  type CapturedEvidence,
  type RunErrorCode,
  type TestRun,
} from '@ghostshopper/domain';

export class ExecutionFailure extends Error {
  constructor(
    readonly code: RunErrorCode,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ExecutionFailure';
  }
}
export interface JourneyExecutor {
  execute(
    run: TestRun,
    signal: AbortSignal,
    recordStep: (step: ActionResult) => Promise<boolean>,
    recordEvidence?: (evidence: CapturedEvidence) => Promise<void>,
  ): Promise<'PASSED' | 'WARNING' | 'FAILED'>;
}
export const pendingJourneyEngine: JourneyExecutor = {
  execute: () => Promise.reject(new ExecutionFailure('JOURNEY_ENGINE_NOT_IMPLEMENTED')),
};

export function createRunProcessor(
  store: RunStore,
  executor: JourneyExecutor,
  log: RunLogger,
  timeoutMs: number,
  evidenceRecorder?: EvidenceRecorder,
  analysisRepository?: AnalysisRepository,
  aiAnalyzer?: RunAiAnalyzer,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new Error('INVALID_RUN_TIMEOUT');
  return async (input: RunMonitorJob): Promise<void> => {
    const job = validate(runMonitorJobSchema, input);
    const started = Date.now();
    const result = await store.claim(job, timeoutMs + 30_000);
    const context = { runId: job.runId, shopId: job.shopId, jobId: job.runId };
    if (result.kind === 'busy') throw new Error('RUN_BUSY');
    if (result.kind === 'ignored') {
      log({ ...context, level: 'info', event: 'run.ignored' });
      return;
    }
    const { claim } = result;
    const metadata = { ...context, monitorId: claim.run.monitorId, attempt: claim.attempt };
    log({ ...metadata, level: 'info', event: 'run.started' });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let execution: Promise<'PASSED' | 'WARNING' | 'FAILED'> | undefined;
    const steps: ActionResult[] = [];
    const diagnostics = new AnalysisDiagnostics();
    const aiEvidence = aiAnalyzer ? new AiEvidence() : null;
    let technicalAnalysis: AnalysisResult | null = null;
    let completed = false;
    let analyzing = false;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Reject first so an abort-aware executor cannot turn timeout into a retry.
          reject(new ExecutionFailure('JOB_TIMEOUT'));
          controller.abort();
        }, timeoutMs);
      });
      execution = executor.execute(
        claim.run,
        controller.signal,
        async (step) => {
          const saved = await store.recordStep(claim, step);
          if (saved) steps.push(step);
          if (saved)
            log({
              ...metadata,
              level: step.status === 'FAILED' ? 'warn' : 'info',
              event: `run.step.${step.action.toLowerCase()}`,
              durationMs: step.durationMs,
              ...(step.errorCode ? { code: step.errorCode } : {}),
            });
          return saved;
        },
        evidenceRecorder || analysisRepository
          ? async (evidence) => {
              diagnostics.capture(evidence);
              try {
                await evidenceRecorder?.(claim, evidence);
              } catch (error) {
                diagnostics.markIncomplete();
                throw error;
              }
              // Optional AI buffering must not change diagnostic completeness or browser results.
              try {
                if (evidenceRecorder) aiEvidence?.capture(evidence);
              } catch {
                log({
                  ...metadata,
                  level: 'warn',
                  event: 'ai.evidence.skipped',
                  code: 'AI_INVALID_INPUT',
                });
              }
            }
          : undefined,
      );
      let outcome = await Promise.race([execution, timeout]);
      if (timer) clearTimeout(timer);
      analyzing = Boolean(analysisRepository);
      if (
        !(await store.advance(claim, 'RUNNING', 'COLLECTING')) ||
        !(await store.advance(claim, 'COLLECTING', 'ANALYZING'))
      ) {
        log({ ...metadata, level: 'warn', event: 'run.ownership.lost', code: 'LEASE_LOST' });
        return;
      }
      if (analysisRepository) {
        analyzing = true;
        const analysis = await analysisRepository.save(claim, {
          steps,
          diagnostics: diagnostics.events,
          diagnosticsComplete: diagnostics.complete,
          journeyOutcome: outcome,
        });
        if (!analysis) {
          log({ ...metadata, level: 'warn', event: 'run.ownership.lost', code: 'LEASE_LOST' });
          return;
        }
        outcome = analysis.outcome;
        technicalAnalysis = analysis;
      }
      if (!(await store.advance(claim, 'ANALYZING', 'COMPLETED', outcome))) {
        log({ ...metadata, level: 'warn', event: 'run.ownership.lost', code: 'LEASE_LOST' });
        return;
      }
      log({ ...metadata, level: 'info', event: 'run.completed', durationMs: Date.now() - started });
      completed = true;
    } catch (error) {
      controller.abort();
      // Keep the lease alive during bounded abort/evidence cleanup. Do not clear
      // ownership before the browser's finally block can persist failure evidence.
      if (evidenceRecorder && execution) {
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            execution.catch(() => undefined),
            new Promise<void>((resolve) => {
              // Reserve time inside the 30-second lease margin for partial analysis.
              cleanupTimer = setTimeout(resolve, analysisRepository ? 20_000 : 25_000);
            }),
          ]);
        } finally {
          if (cleanupTimer) clearTimeout(cleanupTimer);
        }
      }
      const failure = analyzing
        ? new ExecutionFailure('ANALYSIS_FAILED')
        : error instanceof ExecutionFailure
          ? error
          : new ExecutionFailure('EXECUTION_FAILED', true);
      // Preserve partial facts on timeout/startup failure where the lease still permits it.
      // Analysis errors never replay a journey with external cart effects.
      if (analysisRepository && !analyzing) {
        try {
          await analysisRepository.save(claim, {
            steps,
            diagnostics: diagnostics.events,
            diagnosticsComplete: false,
            journeyOutcome: 'FAILED',
          });
        } catch {
          log({
            ...metadata,
            level: 'error',
            event: 'run.analysis.failed',
            code: 'ANALYSIS_FAILED',
          });
        }
      }
      const retry = failure.retryable && claim.attempt < MAX_RUN_ATTEMPTS;
      const updated = await store.fail(claim, failure.code, retry);
      log({
        ...metadata,
        level: 'error',
        event: updated ? (retry ? 'run.retry' : 'run.failed') : 'run.ownership.lost',
        code: failure.code,
        durationMs: Date.now() - started,
      });
      if (updated && retry) throw new Error('RUN_RETRY', { cause: error });
    } finally {
      if (timer) clearTimeout(timer);
    }
    // Deliberately outside the deterministic catch/fail path and after incident commit.
    if (completed && aiAnalyzer && aiEvidence && technicalAnalysis) {
      try {
        const input = aiEvidence.input(claim, steps, technicalAnalysis);
        if (input) await aiAnalyzer.analyze(claim, input);
        else log({ ...metadata, level: 'info', event: 'ai.skipped', code: 'AI_NO_EVIDENCE' });
      } catch {
        log({ ...metadata, level: 'warn', event: 'ai.failed', code: 'AI_ANALYSIS_FAILED' });
      }
    }
  };
}
