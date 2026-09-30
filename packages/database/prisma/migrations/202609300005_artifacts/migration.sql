CREATE TYPE "ArtifactType" AS ENUM ('SCREENSHOT', 'TRACE', 'CONSOLE', 'NETWORK', 'METADATA');
CREATE TYPE "ArtifactStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
CREATE UNIQUE INDEX "RunStep_shopId_runId_attempt_id_key" ON "RunStep" ("shopId", "runId", "attempt", "id");
CREATE TABLE "Artifact" (
  "id" UUID NOT NULL, "shopId" TEXT NOT NULL, "runId" UUID NOT NULL, "attempt" INTEGER NOT NULL, "stepId" UUID, "stepPosition" INTEGER,
  "type" "ArtifactType" NOT NULL, "storageKey" TEXT NOT NULL, "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL, "sha256" VARCHAR(64) NOT NULL, "status" "ArtifactStatus" NOT NULL DEFAULT 'PENDING',
  "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Artifact_shopId_runId_fkey" FOREIGN KEY ("shopId", "runId") REFERENCES "TestRun" ("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Artifact_shopId_runId_attempt_stepId_fkey" FOREIGN KEY ("shopId", "runId", "attempt", "stepId") REFERENCES "RunStep" ("shopId", "runId", "attempt", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Artifact_bounds" CHECK ("attempt" BETWEEN 1 AND 3 AND ("stepPosition" IS NULL OR "stepPosition" BETWEEN 0 AND 6) AND "sizeBytes" BETWEEN 1 AND 20971520 AND "expiresAt" > "createdAt" AND "sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "Artifact_error" CHECK (("status" = 'FAILED' AND "errorCode" IS NOT NULL) OR ("status" <> 'FAILED' AND "errorCode" IS NULL))
);
CREATE UNIQUE INDEX "Artifact_storageKey_key" ON "Artifact" ("storageKey");
CREATE INDEX "Artifact_shopId_runId_attempt_createdAt_idx" ON "Artifact" ("shopId", "runId", "attempt", "createdAt");
CREATE INDEX "Artifact_expiresAt_idx" ON "Artifact" ("expiresAt");
