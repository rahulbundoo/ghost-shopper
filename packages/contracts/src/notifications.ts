import { z } from 'zod';
export const notificationSettingsSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .refine((value) => !/[\r\n]/.test(value)),
  enabled: z.boolean(),
  recoveryEnabled: z.boolean(),
  version: z.number().int().min(0).max(2147483646),
});
export type UpdateNotificationSettings = z.infer<typeof notificationSettingsSchema>;
