-- Existing Phase 2 runs remain inert; only new explicitly requested runs dispatch.
ALTER TABLE "TestRun"
  ADD COLUMN "dispatchRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nextDispatchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" UUID,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "errorCode" TEXT,
  ADD CONSTRAINT "TestRun_attemptCount_check" CHECK ("attemptCount" >= 0 AND "attemptCount" <= 3),
  ADD CONSTRAINT "TestRun_lease_check" CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL));
CREATE INDEX "TestRun_dispatchRequested_status_nextDispatchAt_idx" ON "TestRun"("dispatchRequested", "status", "nextDispatchAt");
