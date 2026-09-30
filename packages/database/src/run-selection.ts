import type { Prisma } from '@prisma/client';
// Never serialize internal lease ownership or dispatch bookkeeping to merchants.
export const publicRunSelection = {
  id: true,
  shopId: true,
  monitorId: true,
  monitorVersion: true,
  scenario: true,
  productId: true,
  variantId: true,
  device: true,
  status: true,
  outcome: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  attemptCount: true,
  errorCode: true,
} satisfies Prisma.TestRunSelect;
