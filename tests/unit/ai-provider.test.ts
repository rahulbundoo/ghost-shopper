import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  OpenAiProvider,
  JOURNEY_PROMPT_VERSION,
  JOURNEY_PROMPT,
} from '../../packages/ai/src/index.js';
import {
  journeyAnalysisSchema,
  journeyAnalysisInputSchema,
} from '../../packages/contracts/src/index.js';
import { aiInput, aiResult } from '../fixtures/ai.js';
const options = {
  apiKey: 'test-secret',
  model: 'configured-model',
  timeoutMs: 1000,
  maxOutputTokens: 2048,
  pricing: { input: 2, cachedInput: 0.5, output: 10 },
};
function response(result: unknown = aiResult, overrides: Record<string, unknown> = {}) {
  return Response.json({
    status: 'completed',
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 100 },
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
    ...overrides,
  });
}
afterEach(() => vi.useRealTimers());
describe('OpenAI structured journey adapter', () => {
  it('pins the v1 prompt so changes require an explicit version review', () => {
    expect(createHash('sha256').update(JOURNEY_PROMPT).digest('hex')).toBe(
      '6a36abafd23a722c2034213345beee61755505233db911e4376eb158b7a79cd2',
    );
  });
  it('uses a fixed endpoint, immutable prompt, bounded images, structured schema and no storage/tools', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response());
    const provider = new OpenAiProvider(options, transport);
    expect(await provider.analyzeJourney(aiInput)).toMatchObject({
      status: 'SUCCEEDED',
      result: aiResult,
      usage: { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 100 },
      estimatedCostUsd: '0.00270000',
    });
    expect(provider.promptVersion).toBe('journey-analysis-v1');
    expect(JOURNEY_PROMPT_VERSION).toBe('journey-analysis-v1');
    const [url, request] = transport.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(request?.redirect).toBe('error');
    if (typeof request?.body !== 'string') throw new Error('Expected JSON request body');
    const body = JSON.parse(request.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: options.model,
      store: false,
      instructions: JOURNEY_PROMPT,
      max_output_tokens: 2048,
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          name: 'journey_analysis',
          schema: { additionalProperties: false },
        },
      },
    });
    expect(body).not.toHaveProperty('tools');
    expect(request.body).not.toContain(options.apiKey);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('applies server severity rules to valid interpretations', async () => {
    const result = { ...aiResult, findings: [{ ...aiResult.findings[0]!, severity: 'HIGH' }] };
    const provider = new OpenAiProvider(
      options,
      vi.fn<typeof fetch>().mockResolvedValue(response(result)),
    );
    expect((await provider.analyzeJourney(aiInput)).result?.findings[0]?.severity).toBe('MEDIUM');
  });
  it.each([
    { ...aiResult, experienceScore: 101 },
    { ...aiResult, findings: [{ ...aiResult.findings[0], type: 'INVENTED' }] },
    { ...aiResult, findings: [{ ...aiResult.findings[0], severity: 'CRITICAL' }] },
    { ...aiResult, findings: [{ ...aiResult.findings[0], confidence: -1 }] },
    { ...aiResult, findings: [{ ...aiResult.findings[0], step: 5 }] },
    { ...aiResult, findings: [{ ...aiResult.findings[0], title: 'x'.repeat(121) }] },
    { ...aiResult, experience: 'GOOD' },
    { ...aiResult, findings: [] },
    { ...aiResult, findings: [aiResult.findings[0], aiResult.findings[0]] },
    { ...aiResult, secret: 'not allowed' },
  ])('rejects invalid or ungrounded output and retains known billable usage', async (result) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(result));
    expect(await new OpenAiProvider(options, transport).analyzeJourney(aiInput)).toMatchObject({
      status: 'FAILED',
      result: null,
      errorCode: 'AI_INVALID_OUTPUT',
      estimatedCostUsd: '0.00270000',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects mobile findings for desktop evidence', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ...aiResult,
        findings: [{ ...aiResult.findings[0], type: 'MOBILE_LAYOUT_ISSUE' }],
      }),
    );
    expect(
      (
        await new OpenAiProvider(options, transport).analyzeJourney({
          ...aiInput,
          device: 'DESKTOP',
        })
      ).status,
    ).toBe('FAILED');
  });
  it.each([
    [
      'AI_REFUSED',
      { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'secret' }] }] },
    ],
    ['AI_INCOMPLETE', { status: 'incomplete' }],
    ['AI_INVALID_OUTPUT', { output: [] }],
  ])('handles %s without saving raw output', async (code, overrides) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(aiResult, overrides));
    const result = await new OpenAiProvider(options, transport).analyzeJourney(aiInput);
    expect(result).toMatchObject({
      status: 'FAILED',
      result: null,
      errorCode: code,
      estimatedCostUsd: '0.00270000',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it.each([401, 429, 500])('does not retry HTTP %s or expose response bodies', async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret', { status }));
    const result = await new OpenAiProvider(options, transport).analyzeJourney(aiInput);
    expect(result).toMatchObject({
      status: 'FAILED',
      result: null,
      usage: null,
      estimatedCostUsd: null,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('bounds response bodies and records unknown cost honestly', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('x'.repeat(128 * 1024 + 1)));
    expect(await new OpenAiProvider(options, transport).analyzeJourney(aiInput)).toMatchObject({
      errorCode: 'AI_RESPONSE_TOO_LARGE',
      estimatedCostUsd: null,
    });
  });
  it('aborts a stalled provider without leaking credentials or retrying', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('secret')), {
            once: true,
          });
        }),
    );
    const work = new OpenAiProvider(options, transport).analyzeJourney(aiInput);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await work).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_TIMEOUT',
      estimatedCostUsd: null,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('requires images, valid steps and bounded closed schemas', () => {
    expect(journeyAnalysisInputSchema.safeParse({ ...aiInput, screenshots: [] }).success).toBe(
      false,
    );
    expect(
      journeyAnalysisInputSchema.safeParse({
        ...aiInput,
        screenshots: [{ ...aiInput.screenshots[0], stepPosition: 6 }],
      }).success,
    ).toBe(false);
    expect(journeyAnalysisInputSchema.safeParse({ ...aiInput, url: 'secret' }).success).toBe(false);
    expect(
      journeyAnalysisSchema.safeParse({
        ...aiResult,
        findings: Array(11).fill(aiResult.findings[0]),
      }).success,
    ).toBe(false);
  });
});
