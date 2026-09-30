import { z } from 'zod';
// Version the payload; only identifiers cross Redis, never credentials or URLs.
export const runMonitorJobSchema = z.strictObject({
  version: z.literal(1),
  shopId: z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/),
  runId: z.uuid(),
});
export type RunMonitorJob = z.infer<typeof runMonitorJobSchema>;
export const RUN_MONITOR = 'RUN_MONITOR';
