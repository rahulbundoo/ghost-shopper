ALTER TABLE "Monitor" ADD COLUMN "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Monitor_enabled_nextRunAt_id_idx" ON "Monitor"("enabled", "nextRunAt", "id");
CREATE TYPE "EmailKind" AS ENUM ('FAILURE', 'RECOVERY');
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');
CREATE TABLE "NotificationChannel" (
  "shopId" TEXT PRIMARY KEY REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "email" VARCHAR(254) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "recoveryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "nextSendAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "EmailDelivery" (
  "id" UUID PRIMARY KEY,
  "shopId" TEXT NOT NULL REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "runId" UUID NOT NULL,
  "monitorId" UUID NOT NULL,
  "configKey" VARCHAR(64) NOT NULL,
  "kind" "EmailKind" NOT NULL,
  "recipient" VARCHAR(254) NOT NULL,
  "channelVersion" INTEGER NOT NULL CHECK ("channelVersion" > 0),
  "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" BETWEEN 0 AND 6),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  FOREIGN KEY ("shopId", "runId") REFERENCES "TestRun"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("shopId", "monitorId", "configKey") REFERENCES "IncidentScope"("shopId", "monitorId", "configKey") ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (("status" = 'SENDING') = ("leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "EmailDelivery_shopId_runId_kind_key" ON "EmailDelivery"("shopId", "runId", "kind");
CREATE INDEX "EmailDelivery_status_nextAttemptAt_idx" ON "EmailDelivery"("status", "nextAttemptAt");
CREATE INDEX "EmailDelivery_shopId_monitorId_configKey_kind_status_idx" ON "EmailDelivery"("shopId", "monitorId", "configKey", "kind", "status");
