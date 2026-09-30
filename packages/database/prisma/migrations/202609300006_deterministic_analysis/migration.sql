CREATE TYPE "FindingType" AS ENUM ('PAGE_UNAVAILABLE', 'PRODUCT_NOT_FOUND', 'BROKEN_IMAGE', 'VARIANT_UNAVAILABLE', 'VARIANT_SELECTOR_FAILURE', 'ADD_TO_CART_FAILURE', 'CART_FAILURE', 'CHECKOUT_FAILURE', 'HTTP_ERROR', 'JS_ERROR', 'SLOW_PAGE');
CREATE TYPE "Severity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "FindingSource" AS ENUM ('DETECTED');
CREATE TYPE "FindingEvidenceType" AS ENUM ('SCREENSHOT', 'CONSOLE', 'NETWORK');
CREATE TYPE "AnalysisOutcome" AS ENUM ('PASSED', 'WARNING', 'FAILED');
CREATE UNIQUE INDEX "Artifact_shopId_runId_attempt_id_key" ON "Artifact" ("shopId", "runId", "attempt", "id");
CREATE TABLE "RunAnalysis" (
  "shopId" TEXT NOT NULL, "runId" UUID NOT NULL, "attempt" INTEGER NOT NULL,
  "rulesVersion" VARCHAR(40) NOT NULL, "score" INTEGER, "complete" BOOLEAN NOT NULL,
  "outcome" "AnalysisOutcome" NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunAnalysis_pkey" PRIMARY KEY ("shopId", "runId", "attempt"),
  CONSTRAINT "RunAnalysis_shopId_runId_fkey" FOREIGN KEY ("shopId", "runId") REFERENCES "TestRun" ("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RunAnalysis_bounds" CHECK ("attempt" BETWEEN 1 AND 3 AND (("complete" AND "score" BETWEEN 0 AND 100 AND "score" IS NOT NULL) OR (NOT "complete" AND "score" IS NULL)))
);
CREATE TABLE "Finding" (
  "id" UUID NOT NULL, "shopId" TEXT NOT NULL, "runId" UUID NOT NULL, "attempt" INTEGER NOT NULL,
  "type" "FindingType" NOT NULL, "severity" "Severity" NOT NULL, "source" "FindingSource" NOT NULL DEFAULT 'DETECTED',
  "fingerprint" VARCHAR(64) NOT NULL, "title" VARCHAR(120) NOT NULL, "description" VARCHAR(500) NOT NULL,
  "stepPosition" INTEGER, "stepId" UUID, "evidenceType" "FindingEvidenceType" NOT NULL, "evidenceArtifactId" UUID,
  "occurrences" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Finding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Finding_shopId_runId_attempt_fkey" FOREIGN KEY ("shopId", "runId", "attempt") REFERENCES "RunAnalysis" ("shopId", "runId", "attempt") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Finding_shopId_runId_attempt_stepId_fkey" FOREIGN KEY ("shopId", "runId", "attempt", "stepId") REFERENCES "RunStep" ("shopId", "runId", "attempt", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Finding_shopId_runId_attempt_evidenceArtifactId_fkey" FOREIGN KEY ("shopId", "runId", "attempt", "evidenceArtifactId") REFERENCES "Artifact" ("shopId", "runId", "attempt", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "Finding_bounds" CHECK ("attempt" BETWEEN 1 AND 3 AND ("stepPosition" IS NULL OR "stepPosition" BETWEEN 0 AND 6) AND "occurrences" BETWEEN 1 AND 407 AND "fingerprint" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "Finding_shopId_runId_attempt_fingerprint_key" ON "Finding" ("shopId", "runId", "attempt", "fingerprint");
CREATE INDEX "Finding_shopId_fingerprint_idx" ON "Finding" ("shopId", "fingerprint");
