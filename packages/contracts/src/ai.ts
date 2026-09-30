import { z } from 'zod';
import {
  EXPERIENCE_FINDING_TYPES,
  JOURNEY_ACTIONS,
  STEP_STATUSES,
  STEP_ERROR_CODES,
  TECHNICAL_FINDING_TYPES,
  SEVERITIES,
} from '@ghostshopper/domain';

export const journeyAnalysisSchema = z.strictObject({
  experience: z.enum(['GOOD', 'WARNING', 'BAD']),
  experienceScore: z.number().int().min(0).max(100),
  findings: z
    .array(
      z.strictObject({
        type: z.enum(EXPERIENCE_FINDING_TYPES),
        severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH']),
        step: z.number().int().min(0).max(6),
        title: z.string().min(1).max(120),
        description: z.string().min(1).max(500),
        evidence: z.string().min(1).max(500),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(10),
});
export const journeyAnalysisInputSchema = z
  .strictObject({
    device: z.enum(['DESKTOP', 'MOBILE']),
    steps: z
      .array(
        z.strictObject({
          position: z.number().int().min(0).max(6),
          action: z.enum(JOURNEY_ACTIONS),
          status: z.enum(STEP_STATUSES),
          durationMs: z.number().int().min(0).max(300_000),
          errorCode: z.enum(STEP_ERROR_CODES).nullable(),
        }),
      )
      .min(1)
      .max(7),
    technicalFindings: z
      .array(
        z.strictObject({
          type: z.enum(TECHNICAL_FINDING_TYPES),
          severity: z.enum(SEVERITIES),
          stepPosition: z.number().int().min(0).max(6).nullable(),
        }),
      )
      .max(88),
    screenshots: z
      .array(
        z.strictObject({
          stepPosition: z.union([z.literal(2), z.literal(3), z.literal(5)]),
          pngBase64: z
            .string()
            .min(12)
            .max(2_796_204)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        }),
      )
      .min(1)
      .max(3),
  })
  .refine(
    (input) =>
      new Set(input.steps.map((step) => step.position)).size === input.steps.length &&
      new Set(input.screenshots.map((shot) => shot.stepPosition)).size ===
        input.screenshots.length &&
      input.screenshots.every((shot) =>
        input.steps.some(
          (step) =>
            step.position === shot.stepPosition &&
            step.status !== 'SKIPPED' &&
            JOURNEY_ACTIONS[step.position] === step.action,
        ),
      ),
  );
export const aiUsageSchema = z
  .strictObject({
    inputTokens: z.number().int().min(0).max(1_000_000),
    cachedInputTokens: z.number().int().min(0).max(1_000_000),
    outputTokens: z.number().int().min(0).max(1_000_000),
  })
  .refine((usage) => usage.cachedInputTokens <= usage.inputTokens);
