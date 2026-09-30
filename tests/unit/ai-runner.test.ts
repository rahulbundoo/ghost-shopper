import { describe, expect, it, vi } from 'vitest';
import { AiEvidence, createAiAnalyzer } from '../../apps/runner/src/ai.js';
import { createRunProcessor, type JourneyExecutor } from '../../apps/runner/src/processor.js';
import { readAiConfig } from '../../packages/config/src/index.js';
import type { AiProvider, RunStore } from '../../packages/application/src/index.js';
import { aiClaim, aiInput, aiCompletion, aiStep, pngBase64 } from '../fixtures/ai.js';
const technical = {
  rulesVersion: 'technical-v1',
  score: 100,
  complete: true,
  outcome: 'PASSED' as const,
  findings: [],
};
function fixture() {
  const provider = {
    provider: 'fake',
    model: 'fake',
    promptVersion: 'journey-analysis-v1',
    pricing: { input: 2, cachedInput: 0.5, output: 10 },
    analyzeJourney: vi.fn<AiProvider['analyzeJourney']>().mockResolvedValue(aiCompletion),
  } satisfies AiProvider;
  const repository = {
    begin: vi.fn().mockResolvedValue('analysis'),
    finish: vi.fn().mockResolvedValue(true),
    expire: vi.fn(),
  };
  const log = vi.fn();
  return { provider, repository, log, analyzer: createAiAnalyzer(provider, repository, log) };
}
describe('optional AI orchestration', () => {
  it('reserves before sending, records metadata/hash and keeps payloads out of logs', async () => {
    const { provider, repository, log, analyzer } = fixture();
    await analyzer.analyze(aiClaim, aiInput);
    expect(repository.begin).toHaveBeenCalledWith(
      aiClaim,
      expect.objectContaining({
        provider: 'fake',
        model: 'fake',
        promptVersion: 'journey-analysis-v1',
        evidenceSteps: [2],
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
      }),
    );
    expect(repository.begin.mock.invocationCallOrder[0]).toBeLessThan(
      provider.analyzeJourney.mock.invocationCallOrder[0]!,
    );
    expect(repository.finish).toHaveBeenCalledWith(aiClaim, 'analysis', aiCompletion);
    expect(JSON.stringify(log.mock.calls)).not.toContain('pngBase64');
  });
  it('does not spend on duplicate reservations or failed persistence', async () => {
    const { provider, repository, analyzer } = fixture();
    repository.begin.mockResolvedValue(null);
    await analyzer.analyze(aiClaim, aiInput);
    repository.begin.mockRejectedValue(new Error('secret'));
    await analyzer.analyze(aiClaim, aiInput);
    expect(provider.analyzeJourney).not.toHaveBeenCalled();
  });
  it('isolates provider throws and failed commits without retrying', async () => {
    const { provider, repository, log, analyzer } = fixture();
    provider.analyzeJourney.mockRejectedValue(new Error('provider-secret'));
    repository.finish.mockRejectedValue(new Error('database-secret'));
    await expect(analyzer.analyze(aiClaim, aiInput)).resolves.toBeUndefined();
    expect(repository.finish).toHaveBeenCalledWith(
      aiClaim,
      'analysis',
      expect.objectContaining({ status: 'FAILED', errorCode: 'AI_PROVIDER_ERROR' }),
    );
    expect(provider.analyzeJourney).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
  it('minimizes evidence and excludes checkout, oversized and non-PNG captures', () => {
    const evidence = new AiEvidence();
    evidence.capture({
      type: 'SCREENSHOT',
      stepPosition: 6,
      body: Buffer.from(pngBase64, 'base64'),
    });
    evidence.capture({ type: 'CONSOLE', stepPosition: 2, body: Buffer.from('secret') });
    evidence.capture({
      type: 'SCREENSHOT',
      stepPosition: 3,
      body: new Uint8Array(2 * 1024 * 1024 + 1),
    });
    evidence.capture({ type: 'SCREENSHOT', stepPosition: 5, body: Buffer.from('not-png') });
    expect(evidence.input(aiClaim, [aiStep], technical)).toBeNull();
    evidence.capture({
      type: 'SCREENSHOT',
      stepPosition: 2,
      body: Buffer.from(pngBase64, 'base64'),
    });
    const input = evidence.input(aiClaim, [aiStep], technical);
    expect(input).toEqual(aiInput);
    expect(JSON.stringify(input)).not.toContain('secret');
    expect(JSON.stringify(input)).not.toContain('private-token');
  });
  it('calls AI only after deterministic completion and never fails/replays the run', async () => {
    const store = {
      claim: vi.fn().mockResolvedValue({ kind: 'claimed', claim: aiClaim }),
      advance: vi.fn().mockResolvedValue(true),
      recordStep: vi.fn().mockResolvedValue(true),
      fail: vi.fn(),
      pending: vi.fn(),
      dispatched: vi.fn(),
    } satisfies RunStore;
    const executor: JourneyExecutor = {
      execute: async (_run, _signal, record, evidence) => {
        await record(aiStep);
        await evidence?.({
          type: 'SCREENSHOT',
          stepPosition: 2,
          body: Buffer.from(pngBase64, 'base64'),
        });
        return 'PASSED';
      },
    };
    const analyzer = { analyze: vi.fn().mockRejectedValue(new Error('provider-secret')) };
    const processRun = createRunProcessor(
      store,
      executor,
      vi.fn(),
      1000,
      vi.fn().mockResolvedValue(undefined),
      { save: vi.fn().mockResolvedValue(technical) },
      analyzer,
    );
    await processRun({ version: 1, shopId: aiClaim.run.shopId, runId: aiClaim.run.id });
    expect(store.advance).toHaveBeenLastCalledWith(aiClaim, 'ANALYZING', 'COMPLETED', 'PASSED');
    expect(store.advance.mock.invocationCallOrder[2]).toBeLessThan(
      analyzer.analyze.mock.invocationCallOrder[0]!,
    );
    expect(store.fail).not.toHaveBeenCalled();
    store.claim.mockResolvedValue({ kind: 'ignored' });
    await processRun({ version: 1, shopId: aiClaim.run.shopId, runId: aiClaim.run.id });
    expect(analyzer.analyze).toHaveBeenCalledTimes(1);
  });
});
describe('AI opt-in configuration', () => {
  const env = {
    AI_ENABLED: 'true',
    OPENAI_API_KEY: 'secret',
    AI_MODEL: 'explicit-model',
    AI_INPUT_USD_PER_MILLION: '2',
    AI_CACHED_INPUT_USD_PER_MILLION: '0.5',
    AI_OUTPUT_USD_PER_MILLION: '10',
  };
  it('is disabled by default even with credentials', () => {
    expect(readAiConfig({})).toBeNull();
    expect(readAiConfig({ OPENAI_API_KEY: 'secret' })).toBeNull();
    expect(readAiConfig({ ...env, AI_ENABLED: 'false' })).toBeNull();
  });
  it('requires a model/rates and limits time and cost without echoing secrets', () => {
    expect(readAiConfig(env)).toMatchObject({
      model: 'explicit-model',
      timeoutMs: 20000,
      maxOutputTokens: 2048,
      pricing: { input: 2, cachedInput: 0.5, output: 10 },
    });
    for (const changes of [
      { AI_MODEL: '' },
      { AI_INPUT_USD_PER_MILLION: '' },
      { AI_CACHED_INPUT_USD_PER_MILLION: '' },
      { AI_CACHED_INPUT_USD_PER_MILLION: '3' },
      { AI_TIMEOUT_MS: '60000' },
      { AI_ENABLED: 'yes' },
      { AI_MAX_OUTPUT_TOKENS: '999999' },
    ]) {
      expect(() => readAiConfig({ ...env, ...changes })).toThrow(
        'GhostShopper setup is incomplete',
      );
    }
  });
});
