import { z } from 'zod';
import {
  DEVICE_PROFILES,
  MONITOR_FREQUENCIES,
  SCENARIOS,
  INCIDENT_STATUSES,
} from '@ghostshopper/domain';

export const entityIdSchema = z.uuid();
const monitorFields = {
  name: z.string().trim().min(1).max(120),
  productId: z.string().regex(/^gid:\/\/shopify\/Product\/[1-9]\d*$/),
  variantId: z
    .string()
    .regex(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/)
    .nullable(),
  scenario: z.enum(SCENARIOS),
  device: z.enum(DEVICE_PROFILES),
  frequency: z.enum(MONITOR_FREQUENCIES),
  enabled: z.boolean(),
};
export const createMonitorSchema = z.strictObject({
  ...monitorFields,
  variantId: monitorFields.variantId.default(null),
  scenario: monitorFields.scenario.default('PURCHASE_JOURNEY'),
  frequency: monitorFields.frequency.default('DAILY'),
  enabled: monitorFields.enabled.default(true),
});
export const updateMonitorSchema = z
  .strictObject(monitorFields)
  .partial()
  .extend({
    version: z.number().int().min(1).max(2_147_483_646),
  })
  .refine(
    (value) => Object.entries(value).some(([key, v]) => key !== 'version' && v !== undefined),
    'At least one change is required.',
  );
export const createTestRunSchema = z.strictObject({ monitorId: entityIdSchema });
export const paginationSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).max(100_000).default(0),
});
export const listTestRunsSchema = paginationSchema.extend({ monitorId: entityIdSchema.optional() });
export const listIncidentsSchema = paginationSchema.extend({
  monitorId: entityIdSchema.optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
});
export type ListIncidentsInput = z.output<typeof listIncidentsSchema>;
export type CreateMonitorInput = z.output<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.output<typeof updateMonitorSchema>;
export type Pagination = z.output<typeof paginationSchema>;
export type ListTestRunsInput = z.output<typeof listTestRunsSchema>;

export class ValidationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super('Invalid input.');
    this.name = 'ValidationError';
  }
}
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Do not echo payloads, unknown property names or library error messages.
    throw new ValidationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? 'input'))),
    ]);
  }
  return result.data;
}
