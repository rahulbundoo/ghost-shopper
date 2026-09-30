import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchPendingRuns,
  type RunClaim,
  type RunStore,
} from '../../packages/application/src/index.js';
import {
  assertRunTransition,
  type RunStatus,
  type TestRun,
} from '../../packages/domain/src/index.js';
import {
  createRunProcessor,
  ExecutionFailure,
  pendingJourneyEngine,
  type JourneyExecutor,
} from '../../apps/runner/src/processor.js';
import {
  runMonitorJobSchema,
  validate,
  type RunMonitorJob,
} from '../../packages/contracts/src/index.js';

const job: RunMonitorJob = {
  version: 1,
  shopId: 'test.myshopify.com',
  runId: '57e735d9-220b-4be1-8fda-fda1c7a71ab5',
};
const run: TestRun = {
  id: job.runId,
  shopId: job.shopId,
  monitorId: '0246091e-d6bc-42b8-a31a-ea073bb7b360',
  monitorVersion: 1,
  scenario: 'PURCHASE_JOURNEY',
  device: 'DESKTOP',
  productId: 'gid://shopify/Product/1',
  variantId: null,
  status: 'RUNNING',
  outcome: null,
  createdAt: new Date(),
  startedAt: new Date(),
  finishedAt: null,
  attemptCount: 1,
  errorCode: null,
};
const claim: RunClaim = { run, token: 'ed0dcc62-60ac-4a2e-a49f-44950e3bb033', attempt: 1 };
function fixture() {
  const store = {
    pending: vi.fn().mockResolvedValue([job]),
    dispatched: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue({ kind: 'claimed', claim }),
    advance: vi.fn<RunStore['advance']>().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
    recordStep: vi.fn().mockResolvedValue(true),
  } satisfies RunStore;
  return { store, log: vi.fn() };
}
afterEach(() => vi.useRealTimers());
describe('run lifecycle rules', () => {
  it('validates ordered stages and outcome consistency', () => {
    expect(() => assertRunTransition('QUEUED', 'RUNNING')).not.toThrow();
    expect(() => assertRunTransition('RUNNING', 'COLLECTING')).not.toThrow();
    expect(() => assertRunTransition('COLLECTING', 'ANALYZING')).not.toThrow();
    expect(() => assertRunTransition('ANALYZING', 'COMPLETED', 'PASSED')).not.toThrow();
    expect(() => assertRunTransition('RUNNING', 'COMPLETED', 'PASSED')).toThrow(
      'INVALID_RUN_TRANSITION',
    );
    expect(() => assertRunTransition('ANALYZING', 'COMPLETED')).toThrow('INVALID_RUN_OUTCOME');
    expect(() => assertRunTransition('RUNNING', 'ERROR', 'PASSED')).toThrow('INVALID_RUN_OUTCOME');
  });
  it.each(['COMPLETED', 'ERROR', 'CANCELLED'] as RunStatus[])(
    'never restarts terminal %s',
    (state) => {
      expect(() => assertRunTransition(state, 'RUNNING')).toThrow('INVALID_RUN_TRANSITION');
    },
  );
  it('allows retries only from active states', () => {
    expect(() => assertRunTransition('RUNNING', 'QUEUED')).not.toThrow();
    expect(() => assertRunTransition('QUEUED', 'QUEUED')).toThrow();
  });
});
describe('durable dispatch', () => {
  it('publishes before acknowledging the durable intent', async () => {
    const { store, log } = fixture();
    const publish = vi.fn().mockResolvedValue(undefined);
    await dispatchPendingRuns(store, { publish }, log);
    expect(publish).toHaveBeenCalledWith(job);
    expect(store.dispatched).toHaveBeenCalledWith(job);
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
      store.dispatched.mock.invocationCallOrder[0]!,
    );
  });
  it('leaves intent pending when Redis fails without logging the exception', async () => {
    const { store, log } = fixture();
    await dispatchPendingRuns(
      store,
      { publish: vi.fn().mockRejectedValue(new Error('redis://secret')) },
      log,
    );
    expect(store.dispatched).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
});
describe('runner processing', () => {
  it('preserves diagnostic facts when their evidence upload fails', async () => {
    const { store, log } = fixture();
    const analysis = { save: vi.fn().mockResolvedValue({ outcome: 'WARNING' }) };
    const executor: JourneyExecutor = {
      execute: async (_run, _signal, _step, evidence) => {
        await evidence?.({
          type: 'CONSOLE',
          stepPosition: null,
          body: Buffer.from(
            JSON.stringify({
              version: 1,
              dropped: 0,
              events: [{ kind: 'pageerror', stepPosition: 0 }],
            }),
          ),
        }).catch(() => undefined);
        return 'WARNING';
      },
    };
    await createRunProcessor(
      store,
      executor,
      log,
      1000,
      vi.fn().mockRejectedValue(new Error('storage-secret')),
      analysis,
    )(job);
    expect(analysis.save).toHaveBeenCalledWith(claim, {
      steps: [],
      diagnostics: [{ kind: 'JS_ERROR', stepPosition: 0, resourceType: null }],
      diagnosticsComplete: false,
      journeyOutcome: 'WARNING',
    });
    expect(store.fail).not.toHaveBeenCalled();
  });
  it('persists analysis before completion and applies its warning outcome', async () => {
    const { store, log } = fixture();
    const analysis = { save: vi.fn().mockResolvedValue({ outcome: 'WARNING' }) };
    await createRunProcessor(
      store,
      { execute: vi.fn().mockResolvedValue('PASSED') },
      log,
      1000,
      undefined,
      analysis,
    )(job);
    expect(analysis.save).toHaveBeenCalledWith(claim, {
      steps: [],
      diagnostics: [],
      diagnosticsComplete: false,
      journeyOutcome: 'PASSED',
    });
    expect(store.advance).toHaveBeenLastCalledWith(claim, 'ANALYZING', 'COMPLETED', 'WARNING');
    expect(analysis.save.mock.invocationCallOrder[0]).toBeLessThan(
      store.advance.mock.invocationCallOrder[2]!,
    );
  });
  it('does not complete or replay cart effects when analysis storage fails', async () => {
    const { store, log } = fixture();
    await createRunProcessor(
      store,
      { execute: vi.fn().mockResolvedValue('PASSED') },
      log,
      1000,
      undefined,
      { save: vi.fn().mockRejectedValue(new Error('database-secret')) },
    )(job);
    expect(store.fail).toHaveBeenCalledWith(claim, 'ANALYSIS_FAILED', false);
    expect(store.advance).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain('database-secret');
  });
  it('does not complete when analysis rejects a stale lease', async () => {
    const { store, log } = fixture();
    await createRunProcessor(
      store,
      { execute: vi.fn().mockResolvedValue('PASSED') },
      log,
      1000,
      undefined,
      { save: vi.fn().mockResolvedValue(null) },
    )(job);
    expect(store.advance).toHaveBeenCalledTimes(2);
    expect(store.fail).not.toHaveBeenCalled();
  });
  it('attempts incomplete analysis for browser failures without changing their error outcome', async () => {
    const { store, log } = fixture();
    const analysis = { save: vi.fn().mockResolvedValue({ outcome: 'FAILED' }) };
    await createRunProcessor(
      store,
      { execute: vi.fn().mockRejectedValue(new ExecutionFailure('BROWSER_UNAVAILABLE')) },
      log,
      1000,
      undefined,
      analysis,
    )(job);
    expect(analysis.save).toHaveBeenCalledWith(claim, {
      steps: [],
      diagnostics: [],
      diagnosticsComplete: false,
      journeyOutcome: 'FAILED',
    });
    expect(store.fail).toHaveBeenCalledWith(claim, 'BROWSER_UNAVAILABLE', false);
  });
  it('processes injected test execution through all stages', async () => {
    const { store, log } = fixture();
    const execute = vi.fn().mockResolvedValue('PASSED');
    await createRunProcessor(store, { execute }, log, 1000)(job);
    expect(execute).toHaveBeenCalledWith(
      run,
      expect.any(AbortSignal),
      expect.any(Function),
      undefined,
    );
    expect(store.advance.mock.calls.map((call) => call.slice(1))).toEqual([
      ['RUNNING', 'COLLECTING'],
      ['COLLECTING', 'ANALYZING'],
      ['ANALYZING', 'COMPLETED', 'PASSED'],
    ]);
    expect(store.fail).not.toHaveBeenCalled();
  });
  it('reports the unimplemented browser engine honestly', async () => {
    const { store, log } = fixture();
    await createRunProcessor(store, pendingJourneyEngine, log, 1000)(job);
    expect(store.fail).toHaveBeenCalledWith(claim, 'JOURNEY_ENGINE_NOT_IMPLEMENTED', false);
    expect(store.advance).not.toHaveBeenCalled();
  });
  it.each(['ignored', 'busy'])('does not execute %s deliveries', async (kind) => {
    const { store, log } = fixture();
    store.claim.mockResolvedValue({ kind });
    const execute = vi.fn();
    const work = createRunProcessor(store, { execute }, log, 1000)(job);
    if (kind === 'busy') await expect(work).rejects.toThrow('RUN_BUSY');
    else await work;
    expect(execute).not.toHaveBeenCalled();
  });
  it('retries transient failures within the persisted attempt budget', async () => {
    const { store, log } = fixture();
    const execute = vi.fn().mockRejectedValue(new Error('sensitive failure'));
    await expect(createRunProcessor(store, { execute }, log, 1000)(job)).rejects.toThrow(
      'RUN_RETRY',
    );
    expect(store.fail).toHaveBeenCalledWith(claim, 'EXECUTION_FAILED', true);
    store.claim.mockResolvedValue({ kind: 'claimed', claim: { ...claim, attempt: 3 } });
    await createRunProcessor(store, { execute }, log, 1000)(job);
    expect(store.fail).toHaveBeenLastCalledWith(
      { ...claim, attempt: 3 },
      'EXECUTION_FAILED',
      false,
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive');
  });
  it('does not advance after ownership loss', async () => {
    const { store, log } = fixture();
    store.advance.mockResolvedValue(false);
    await createRunProcessor(
      store,
      { execute: vi.fn().mockResolvedValue('PASSED') },
      log,
      1000,
    )(job);
    expect(store.advance).toHaveBeenCalledTimes(1);
  });
  it('aborts timed-out work without automatically replaying external effects', async () => {
    vi.useFakeTimers();
    const { store, log } = fixture();
    let signal: AbortSignal | undefined;
    const work = createRunProcessor(
      store,
      {
        execute: (_run, received) => {
          signal = received;
          return new Promise(() => {});
        },
      },
      log,
      10,
    )(job);
    await vi.advanceTimersByTimeAsync(11);
    await work;
    expect(signal?.aborted).toBe(true);
    expect(store.fail).toHaveBeenCalledWith(claim, 'JOB_TIMEOUT', false);
  });
  it('flushes timeout evidence before releasing the claim', async () => {
    vi.useFakeTimers();
    const { store, log } = fixture();
    const record = vi.fn().mockResolvedValue(undefined);
    const executor: JourneyExecutor = {
      execute: async (_run, signal, _step, evidence) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              setTimeout(resolve, 100);
            },
            { once: true },
          ),
        );
        await evidence?.({ type: 'METADATA', stepPosition: null, body: new Uint8Array([1]) });
        return 'FAILED';
      },
    };
    const work = createRunProcessor(store, executor, log, 10, record)(job);
    await vi.advanceTimersByTimeAsync(11);
    expect(store.fail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await work;
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(
      store.fail.mock.invocationCallOrder[0]!,
    );
    expect(store.fail).toHaveBeenCalledWith(claim, 'JOB_TIMEOUT', false);
  });
  it('bounds evidence cleanup when the executor never settles', async () => {
    vi.useFakeTimers();
    const { store, log } = fixture();
    const work = createRunProcessor(
      store,
      { execute: () => new Promise(() => {}) },
      log,
      10,
      vi.fn(),
    )(job);
    await vi.advanceTimersByTimeAsync(11);
    expect(store.fail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25000);
    await work;
    expect(store.fail).toHaveBeenCalledWith(claim, 'JOB_TIMEOUT', false);
  });
  it('reserves lease time for partial analysis after timeout cleanup', async () => {
    vi.useFakeTimers();
    const { store, log } = fixture();
    const analysis = { save: vi.fn().mockResolvedValue({ outcome: 'FAILED' }) };
    const work = createRunProcessor(
      store,
      { execute: () => new Promise(() => {}) },
      log,
      10,
      vi.fn(),
      analysis,
    )(job);
    await vi.advanceTimersByTimeAsync(20011);
    await work;
    expect(analysis.save).toHaveBeenCalledWith(claim, {
      steps: [],
      diagnostics: [],
      diagnosticsComplete: false,
      journeyOutcome: 'FAILED',
    });
    expect(store.fail).toHaveBeenCalledWith(claim, 'JOB_TIMEOUT', false);
  });
  it('does not log raw executor errors or accept credentials in queue payloads', () => {
    expect(() => validate(runMonitorJobSchema, { ...job, accessToken: 'secret' })).toThrow();
    expect(new ExecutionFailure('JOB_TIMEOUT').message).toBe('JOB_TIMEOUT');
  });
});
