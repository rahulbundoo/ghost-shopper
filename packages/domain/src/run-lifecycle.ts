import type { RunOutcome, RunStatus } from './index.js';

export const MAX_RUN_ATTEMPTS = 3;
export const RUN_ERROR_CODES = [
  'JOURNEY_ENGINE_NOT_IMPLEMENTED',
  'BROWSER_UNAVAILABLE',
  'BROWSER_EXECUTION_FAILED',
  'EXECUTION_FAILED',
  'ANALYSIS_FAILED',
  'JOB_TIMEOUT',
  'ATTEMPTS_EXHAUSTED',
  'SHOP_INACTIVE',
  'MONITOR_DISABLED',
] as const;
export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];
export function isTerminalRun(status: RunStatus): boolean {
  return status === 'COMPLETED' || status === 'ERROR' || status === 'CANCELLED';
}
const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  QUEUED: ['RUNNING', 'ERROR', 'CANCELLED'],
  RUNNING: ['COLLECTING', 'QUEUED', 'ERROR', 'CANCELLED'],
  COLLECTING: ['ANALYZING', 'QUEUED', 'ERROR', 'CANCELLED'],
  ANALYZING: ['COMPLETED', 'QUEUED', 'ERROR', 'CANCELLED'],
  COMPLETED: [],
  ERROR: [],
  CANCELLED: [],
};
export function assertRunTransition(
  from: RunStatus,
  to: RunStatus,
  outcome: RunOutcome | null = null,
): void {
  if (!transitions[from].includes(to)) throw new Error('INVALID_RUN_TRANSITION');
  const valid =
    to === 'COMPLETED'
      ? outcome === 'PASSED' || outcome === 'WARNING' || outcome === 'FAILED'
      : to === 'ERROR'
        ? outcome === 'ERROR'
        : to === 'CANCELLED'
          ? outcome === 'CANCELLED'
          : outcome === null;
  if (!valid) throw new Error('INVALID_RUN_OUTCOME');
}
