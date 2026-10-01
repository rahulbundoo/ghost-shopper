import { z } from 'zod';
export const billingActionSchema = z
  .object({ action: z.enum(['checkout', 'cancel', 'refresh']) })
  .strict();
const id = z.string().regex(/^gid:\/\/shopify\/AppSubscription\/\d+$/);
export const subscriptionResultSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({
    shop: z.object({ myshopifyDomain: z.string() }),
    currentAppInstallation: z.object({
      activeSubscriptions: z.array(
        z.object({
          id,
          name: z.string(),
          status: z.string(),
          test: z.boolean(),
          currentPeriodEnd: z.string().datetime().nullable(),
          lineItems: z.array(
            z.object({
              plan: z.object({
                pricingDetails: z.object({
                  __typename: z.string(),
                  interval: z.string().optional(),
                  price: z.object({ amount: z.string(), currencyCode: z.string() }).optional(),
                }),
              }),
            }),
          ),
        }),
      ),
    }),
  }),
});
export const checkoutResultSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({
    appSubscriptionCreate: z.object({
      userErrors: z.array(z.unknown()),
      confirmationUrl: z.string().url().nullable(),
      appSubscription: z.object({ id }).nullable(),
    }),
  }),
});
export const cancelResultSchema = z.object({
  errors: z.array(z.unknown()).optional(),
  data: z.object({
    appSubscriptionCancel: z.object({
      userErrors: z.array(z.unknown()),
      appSubscription: z.object({ id, status: z.string() }).nullable(),
    }),
  }),
});
