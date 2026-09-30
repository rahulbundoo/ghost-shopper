import { z } from 'zod';
import { ARTIFACT_TYPES } from '@ghostshopper/domain';
export const artifactReservationSchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(ARTIFACT_TYPES),
  stepPosition: z.number().int().min(0).max(6).nullable(),
  storageKey: z
    .string()
    .regex(/^evidence\/[a-f0-9]{64}\/[a-f0-9-]{36}\/[1-3]\/[a-f0-9-]{36}\.(png|zip|json)$/),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.date(),
});
