CREATE TABLE "RateLimitBucket" (
  "key" VARCHAR(64) PRIMARY KEY,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL CHECK ("count" > 0)
);
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");
CREATE TABLE "ArtifactDeletion" (
  "storageKey" TEXT PRIMARY KEY,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(40)
);
CREATE INDEX "ArtifactDeletion_nextAttemptAt_idx" ON "ArtifactDeletion"("nextAttemptAt");
INSERT INTO "ArtifactDeletion" ("storageKey", "nextAttemptAt") SELECT "storageKey", "expiresAt" FROM "Artifact" ON CONFLICT DO NOTHING;
CREATE TABLE "ServiceHeartbeat" (
  "id" VARCHAR(64) PRIMARY KEY,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
