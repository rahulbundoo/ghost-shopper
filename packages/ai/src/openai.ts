import { z } from 'zod';
import type { AiProvider } from '@ghostshopper/application';
import {
  aiUsageSchema,
  journeyAnalysisInputSchema,
  journeyAnalysisSchema,
} from '@ghostshopper/contracts';
import {
  EXPERIENCE_SEVERITY,
  type AiCompletion,
  type AiUsage,
  type JourneyAnalysisInput,
} from '@ghostshopper/domain';
import { JOURNEY_PROMPT, JOURNEY_PROMPT_VERSION } from './prompt.js';

const envelopeSchema = z.object({
  status: z.string(),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      input_tokens_details: z.object({ cached_tokens: z.number() }).optional(),
    })
    .nullable()
    .optional(),
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      }),
    )
    .max(32),
});
class SafeAiError extends Error {}
export interface OpenAiOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  /** USD per million tokens, explicitly configured and snapshotted with each request. */
  readonly pricing: AiProvider['pricing'];
}
export class OpenAiProvider implements AiProvider {
  readonly provider = 'openai';
  readonly promptVersion = JOURNEY_PROMPT_VERSION;
  readonly model: string;
  readonly pricing: AiProvider['pricing'];
  constructor(
    private readonly options: OpenAiOptions,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.model = options.model;
    this.pricing = options.pricing;
  }
  async analyzeJourney(input: JourneyAnalysisInput): Promise<AiCompletion> {
    const started = Date.now();
    let responseAt: Date | null = null;
    let usage: AiUsage | null = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const complete = (
      status: 'SUCCEEDED' | 'FAILED',
      result: AiCompletion['result'],
      errorCode: string | null,
    ): AiCompletion => ({
      status,
      result,
      errorCode,
      responseAt,
      latencyMs: Math.max(0, Date.now() - started),
      usage,
      estimatedCostUsd: usage
        ? (
            ((usage.inputTokens - usage.cachedInputTokens) * this.pricing.input +
              usage.cachedInputTokens * this.pricing.cachedInput +
              usage.outputTokens * this.pricing.output) /
            1_000_000
          ).toFixed(8)
        : null,
    });
    try {
      const parsedInput = journeyAnalysisInputSchema.safeParse(input);
      if (!parsedInput.success) throw new SafeAiError('AI_INVALID_INPUT');
      const data = parsedInput.data;
      for (const shot of data.screenshots) {
        const bytes = Buffer.from(shot.pngBase64, 'base64');
        if (
          bytes.length > 2 * 1024 * 1024 ||
          bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        )
          throw new SafeAiError('AI_INVALID_INPUT');
      }
      const { screenshots, ...summary } = data;
      // Native fetch keeps this single-endpoint adapter small. Never follow redirects
      // or accept a merchant-configurable endpoint. No retries after ambiguous billing.
      const response = await this.transport('https://api.openai.com/v1/responses', {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          max_output_tokens: this.options.maxOutputTokens,
          instructions: JOURNEY_PROMPT,
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: JSON.stringify(summary) },
                ...screenshots.flatMap((shot) => [
                  { type: 'input_text', text: `Screenshot for step ${shot.stepPosition}` },
                  {
                    type: 'input_image',
                    image_url: `data:image/png;base64,${shot.pngBase64}`,
                    detail: 'low',
                  },
                ]),
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'journey_analysis',
              strict: true,
              schema: z.toJSONSchema(journeyAnalysisSchema, { target: 'draft-07' }),
            },
          },
        }),
      });
      responseAt = new Date();
      if (!response.ok) {
        await response.body?.cancel();
        throw new SafeAiError(response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR');
      }
      const envelope = envelopeSchema.parse(await readBoundedJson(response));
      responseAt = new Date();
      if (envelope.usage) {
        usage = aiUsageSchema.parse({
          inputTokens: envelope.usage.input_tokens,
          outputTokens: envelope.usage.output_tokens,
          cachedInputTokens: envelope.usage.input_tokens_details?.cached_tokens ?? 0,
        });
      }
      if (envelope.status !== 'completed') throw new SafeAiError('AI_INCOMPLETE');
      const contents = envelope.output
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? []);
      if (contents.some((item) => item.type === 'refusal')) throw new SafeAiError('AI_REFUSED');
      const texts = contents.filter((item) => item.type === 'output_text');
      if (texts.length !== 1 || !texts[0]?.text) throw new SafeAiError('AI_INVALID_OUTPUT');
      const result = journeyAnalysisSchema.parse(JSON.parse(texts[0].text));
      if (
        (result.experience === 'GOOD') !== (result.findings.length === 0) ||
        result.findings.some(
          (finding) =>
            !screenshots.some((shot) => shot.stepPosition === finding.step) ||
            (finding.type === 'MOBILE_LAYOUT_ISSUE' && data.device !== 'MOBILE'),
        ) ||
        new Set(result.findings.map((finding) => `${finding.type}:${finding.step}`)).size !==
          result.findings.length
      )
        throw new SafeAiError('AI_INVALID_OUTPUT');
      return complete(
        'SUCCEEDED',
        {
          ...result,
          findings: result.findings.map((finding) => ({
            ...finding,
            severity: EXPERIENCE_SEVERITY[finding.type],
          })),
        },
        null,
      );
    } catch (error) {
      return complete(
        'FAILED',
        null,
        controller.signal.aborted
          ? 'AI_TIMEOUT'
          : error instanceof SafeAiError
            ? error.message
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 'AI_INVALID_OUTPUT'
              : 'AI_PROVIDER_ERROR',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new SafeAiError('AI_INVALID_OUTPUT');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value: unknown = chunk.value;
      if (!(value instanceof Uint8Array)) throw new SafeAiError('AI_INVALID_OUTPUT');
      size += value.length;
      if (size > 128 * 1024) throw new SafeAiError('AI_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
