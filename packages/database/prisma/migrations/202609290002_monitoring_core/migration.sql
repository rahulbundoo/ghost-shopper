-- Additive Phase 2 migration: existing shops and sessions are retained.
CREATE TYPE "Scenario" AS ENUM ('PURCHASE_JOURNEY');
CREATE TYPE "DeviceProfile" AS ENUM ('DESKTOP', 'MOBILE');
CREATE TYPE "MonitorFrequency" AS ENUM ('HOURLY', 'EVERY_SIX_HOURS', 'DAILY');
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COLLECTING', 'ANALYZING', 'COMPLETED', 'ERROR', 'CANCELLED');
CREATE TYPE "RunOutcome" AS ENUM ('PASSED', 'WARNING', 'FAILED', 'ERROR', 'CANCELLED');

CREATE TABLE "Monitor" (
    "id" UUID NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "scenario" "Scenario" NOT NULL DEFAULT 'PURCHASE_JOURNEY',
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "device" "DeviceProfile" NOT NULL,
    "frequency" "MonitorFrequency" NOT NULL DEFAULT 'DAILY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Monitor_name_check" CHECK (length(trim("name")) > 0),
    CONSTRAINT "Monitor_version_check" CHECK ("version" > 0),
    CONSTRAINT "Monitor_product_check" CHECK ("productId" ~ '^gid://shopify/Product/[1-9][0-9]*$'),
    CONSTRAINT "Monitor_variant_check" CHECK ("variantId" IS NULL OR "variantId" ~ '^gid://shopify/ProductVariant/[1-9][0-9]*$')
);
CREATE TABLE "TestRun" (
    "id" UUID NOT NULL,
    "shopId" TEXT NOT NULL,
    "monitorId" UUID NOT NULL,
    "monitorVersion" INTEGER NOT NULL,
    "scenario" "Scenario" NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "device" "DeviceProfile" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "outcome" "RunOutcome",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TestRun_monitorVersion_check" CHECK ("monitorVersion" > 0),
    CONSTRAINT "TestRun_product_check" CHECK ("productId" ~ '^gid://shopify/Product/[1-9][0-9]*$'),
    CONSTRAINT "TestRun_variant_check" CHECK ("variantId" IS NULL OR "variantId" ~ '^gid://shopify/ProductVariant/[1-9][0-9]*$'),
    CONSTRAINT "TestRun_state_check" CHECK (
      ("status" = 'QUEUED' AND "outcome" IS NULL AND "startedAt" IS NULL AND "finishedAt" IS NULL) OR
      ("status" IN ('RUNNING', 'COLLECTING', 'ANALYZING') AND "outcome" IS NULL AND "startedAt" IS NOT NULL AND "finishedAt" IS NULL) OR
      ("status" = 'COMPLETED' AND "outcome" IS NOT NULL AND "outcome" IN ('PASSED', 'WARNING', 'FAILED') AND "startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL) OR
      ("status" = 'ERROR' AND "outcome" IS NOT NULL AND "outcome" = 'ERROR' AND "finishedAt" IS NOT NULL) OR
      ("status" = 'CANCELLED' AND "outcome" IS NOT NULL AND "outcome" = 'CANCELLED' AND "finishedAt" IS NOT NULL)
    ),
    CONSTRAINT "TestRun_time_check" CHECK (
      ("startedAt" IS NULL OR "startedAt" >= "createdAt") AND
      ("finishedAt" IS NULL OR "finishedAt" >= COALESCE("startedAt", "createdAt"))
    )
);
CREATE UNIQUE INDEX "Monitor_shopId_id_key" ON "Monitor"("shopId", "id");
CREATE INDEX "Monitor_shopId_createdAt_id_idx" ON "Monitor"("shopId", "createdAt", "id");
CREATE UNIQUE INDEX "TestRun_shopId_id_key" ON "TestRun"("shopId", "id");
CREATE INDEX "TestRun_shopId_createdAt_id_idx" ON "TestRun"("shopId", "createdAt", "id");
CREATE INDEX "TestRun_shopId_monitorId_createdAt_id_idx" ON "TestRun"("shopId", "monitorId", "createdAt", "id");
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_shopId_monitorId_fkey" FOREIGN KEY ("shopId", "monitorId") REFERENCES "Monitor"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
