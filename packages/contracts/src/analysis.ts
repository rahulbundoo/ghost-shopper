import { z } from 'zod';
import { actionResultSchema } from './journey.js';
export const captureManifestSchema = z.object({
  version: z.literal(1),
  captureErrors: z.array(z.string().max(64)).max(32),
});
export const analysisInputSchema = z.strictObject({
  steps: z
    .array(actionResultSchema)
    .max(7)
    .refine((steps) => new Set(steps.map((step) => step.position)).size === steps.length),
  diagnostics: z
    .array(
      z.strictObject({
        kind: z.enum(['JS_ERROR', 'HTTP_ERROR']),
        stepPosition: z.number().int().min(0).max(6).nullable(),
        resourceType: z.string().max(32).nullable(),
      }),
    )
    .max(400),
  diagnosticsComplete: z.boolean(),
  journeyOutcome: z.enum(['PASSED', 'WARNING', 'FAILED']),
});
// Parse only the bounded, privacy-preserving fields used by deterministic rules.
export const diagnosticExportSchema = z.object({
  version: z.literal(1),
  dropped: z.number().int().min(0),
  events: z
    .array(
      z.object({
        kind: z.string().max(32),
        stepPosition: z.number().int().min(0).max(6).nullable(),
        status: z.number().int().min(100).max(599).optional(),
        resourceType: z.string().max(32).optional(),
      }),
    )
    .max(200),
});
