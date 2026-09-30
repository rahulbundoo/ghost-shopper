import type { RunMonitorJob } from '@ghostshopper/contracts';
import type {
  ActionResult,
  RunErrorCode,
  RunOutcome,
  RunStatus,
  TestRun,
} from '@ghostshopper/domain';

export interface RunClaim {
  readonly run: TestRun;
  readonly token: string;
  readonly attempt: number;
}
export type ClaimResult =
  { kind: 'claimed'; claim: RunClaim } | { kind: 'ignored' } | { kind: 'busy' };
export interface RunStore {
  pending(limit: number): Promise<RunMonitorJob[]>;
  dispatched(job: RunMonitorJob): Promise<void>;
  claim(job: RunMonitorJob, leaseMs: number): Promise<ClaimResult>;
  advance(claim: RunClaim, from: RunStatus, to: RunStatus, outcome?: RunOutcome): Promise<boolean>;
  fail(claim: RunClaim, code: RunErrorCode, retry: boolean): Promise<boolean>;
  recordStep(claim: RunClaim, result: ActionResult): Promise<boolean>;
}
export interface RunPublisher {
  publish(job: RunMonitorJob): Promise<void>;
}
export type RunLogEvent = {
  level: 'info' | 'warn' | 'error';
  event: string;
  runId?: string;
  shopId?: string;
  monitorId?: string;
  jobId?: string;
  attempt?: number;
  durationMs?: number;
  code?: string;
};
export type RunLogger = (event: RunLogEvent) => void;

export async function dispatchPendingRuns(
  store: RunStore,
  publisher: RunPublisher,
  log: RunLogger,
): Promise<void> {
  for (const job of await store.pending(50)) {
    try {
      await publisher.publish(job);
      await store.dispatched(job);
      log({
        level: 'info',
        event: 'run.dispatched',
        runId: job.runId,
        shopId: job.shopId,
        jobId: job.runId,
      });
    } catch {
      log({
        level: 'warn',
        event: 'run.dispatch.deferred',
        runId: job.runId,
        shopId: job.shopId,
        code: 'QUEUE_UNAVAILABLE',
      });
      // Leave durable intent pending. Avoid hammering an unavailable dependency.
      break;
    }
  }
}
