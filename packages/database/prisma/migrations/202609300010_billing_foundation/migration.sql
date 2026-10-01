CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'INACTIVE');
CREATE TABLE "Subscription" (
  "shopId" TEXT PRIMARY KEY REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  "trialEndsAt" TIMESTAMP(3) NOT NULL,
  "everPaid" BOOLEAN NOT NULL DEFAULT false,
  "providerId" TEXT,
  "policyKey" TEXT,
  "periodEnd" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "syncStartedAt" TIMESTAMP(3),
  "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkoutToken" UUID,
  "checkoutExpiresAt" TIMESTAMP(3),
  "approvalUrl" TEXT,
  CHECK ("status" <> 'ACTIVE' OR ("providerId" IS NOT NULL AND "periodEnd" IS NOT NULL AND "verifiedAt" IS NOT NULL))
);
CREATE INDEX "Subscription_nextSyncAt_idx" ON "Subscription"("nextSyncAt");
CREATE TABLE "UsageRecord" (
  "id" UUID PRIMARY KEY,
  "shopId" TEXT NOT NULL REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "runId" UUID NOT NULL,
  "periodKey" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("shopId", "runId") REFERENCES "TestRun"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UsageRecord_shopId_periodKey_idx" ON "UsageRecord"("shopId", "periodKey");
CREATE UNIQUE INDEX "UsageRecord_shopId_runId_key" ON "UsageRecord"("shopId", "runId");
