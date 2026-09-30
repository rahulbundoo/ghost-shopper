import { createHash } from 'node:crypto';
import type {
  AiAnalysisRepository,
  AiProvider,
  RunClaim,
  RunLogger,
} from '@ghostshopper/application';
import { journeyAnalysisInputSchema } from '@ghostshopper/contracts';
import type {
  ActionResult,
  AnalysisResult,
  CapturedEvidence,
  JourneyAnalysisInput,
} from '@ghostshopper/domain';

export interface RunAiAnalyzer {
  analyze(claim: RunClaim, input: JourneyAnalysisInput): Promise<void>;
}
/** Selects at most 6 MiB of masked PNG data, base64-encoded in memory; no checkout or traces. */
export class AiEvidence {
  private readonly shots = new Map<number, string>();
  capture(evidence: CapturedEvidence) {
    if (
      evidence.type !== 'SCREENSHOT' ||
      evidence.stepPosition === null ||
      ![2, 3, 5].includes(evidence.stepPosition) ||
      evidence.body.byteLength > 2 * 1024 * 1024
    )
      return;
    if (Buffer.from(evidence.body.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a') return;
    this.shots.set(evidence.stepPosition, Buffer.from(evidence.body).toString('base64'));
  }
  input(
    claim: RunClaim,
    steps: readonly ActionResult[],
    analysis: AnalysisResult,
  ): JourneyAnalysisInput | null {
    const screenshots = [...this.shots]
      .sort(([a], [b]) => a - b)
      .map(([stepPosition, pngBase64]) => ({ stepPosition, pngBase64 }));
    this.shots.clear();
    if (!screenshots.length) return null;
    return journeyAnalysisInputSchema.parse({
      device: claim.run.device,
      steps: steps.map(({ action, position, status, durationMs, errorCode }) => ({
        action,
        position,
        status,
        durationMs,
        errorCode,
      })),
      technicalFindings: analysis.findings.map(({ type, severity, stepPosition }) => ({
        type,
        severity,
        stepPosition,
      })),
      screenshots,
    });
  }
}
export function createAiAnalyzer(
  provider: AiProvider,
  repository: AiAnalysisRepository,
  log: RunLogger,
): RunAiAnalyzer {
  return {
    async analyze(claim, raw) {
      const context = { runId: claim.run.id, shopId: claim.run.shopId, attempt: claim.attempt };
      try {
        const input = journeyAnalysisInputSchema.parse(raw);
        const id = await repository.begin(claim, {
          provider: provider.provider,
          model: provider.model,
          promptVersion: provider.promptVersion,
          pricing: provider.pricing,
          requestedAt: new Date(),
          inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
          evidenceSteps: input.screenshots.map((shot) => shot.stepPosition),
        });
        if (!id) {
          log({ ...context, level: 'info', event: 'ai.skipped' });
          return;
        }
        let completion;
        try {
          completion = await provider.analyzeJourney(input);
        } catch {
          completion = {
            status: 'FAILED' as const,
            responseAt: null,
            latencyMs: 0,
            usage: null,
            estimatedCostUsd: null,
            result: null,
            errorCode: 'AI_PROVIDER_ERROR',
          };
        }
        if (!(await repository.finish(claim, id, completion))) {
          log({
            ...context,
            level: 'warn',
            event: 'ai.commit.rejected',
            code: 'AI_ANALYSIS_FAILED',
          });
          return;
        }
        log({
          ...context,
          level: completion.status === 'SUCCEEDED' ? 'info' : 'warn',
          event: `ai.${completion.status.toLowerCase()}`,
          durationMs: completion.latencyMs,
          ...(completion.errorCode ? { code: completion.errorCode } : {}),
        });
      } catch {
        // Reservation/commit failures also remain independent of the completed run.
        // A stranded reservation expires without repeating a potentially billed request.
        log({ ...context, level: 'warn', event: 'ai.failed', code: 'AI_ANALYSIS_FAILED' });
      }
    },
  };
}
