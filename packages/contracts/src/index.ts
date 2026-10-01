import { z } from 'zod';
export * from './monitoring.js';
export * from './jobs.js';
export * from './journey.js';
export * from './artifacts.js';
export * from './analysis.js';

export const shopDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/);

export const shopProfileSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Shop\/\d+$/),
  name: z.string().min(1),
  myshopifyDomain: shopDomainSchema,
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  primaryDomain: z.object({
    url: z.url().refine((value) => new URL(value).protocol === 'https:'),
  }),
});
export type ShopProfile = z.infer<typeof shopProfileSchema>;

export const shopQueryResultSchema = z.object({
  data: z.object({ shop: shopProfileSchema }),
  errors: z.array(z.unknown()).optional(),
});
export const scopesUpdateSchema = z.object({ current: z.array(z.string()) });
export * from './ai.js';
export * from './notifications.js';
export * from './billing.js';
