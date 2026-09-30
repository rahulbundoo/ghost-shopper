import { z } from 'zod';
import { JOURNEY_ACTIONS, STEP_ERROR_CODES, STEP_STATUSES } from '@ghostshopper/domain';
export const actionResultSchema = z
  .strictObject({
    action: z.enum(JOURNEY_ACTIONS),
    position: z.number().int().min(0).max(6),
    status: z.enum(STEP_STATUSES),
    startedAt: z.date(),
    finishedAt: z.date(),
    durationMs: z.number().int().min(0).max(300_000),
    currentUrl: z
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        );
      })
      .nullable(),
    errorCode: z.enum(STEP_ERROR_CODES).nullable(),
    errorMessage: z.string().max(240).nullable(),
  })
  .refine(
    (v) =>
      JOURNEY_ACTIONS[v.position] === v.action &&
      v.finishedAt.getTime() - v.startedAt.getTime() === v.durationMs &&
      (v.status === 'PASSED'
        ? v.errorCode === null && v.errorMessage === null
        : v.errorCode !== null && v.errorMessage !== null) &&
      (v.status !== 'SKIPPED' || v.errorCode === 'PREVIOUS_STEP_FAILED'),
  );
