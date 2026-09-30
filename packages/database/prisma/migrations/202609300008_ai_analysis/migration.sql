CREATE TYPE "AiAnalysisStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TABLE "AiAnalysis" (
  "id" UUID NOT NULL,
  "shopId" TEXT NOT NULL,
  "runId" UUID NOT NULL,
  "attempt" INTEGER NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "model" VARCHAR(100) NOT NULL,
  "promptVersion" VARCHAR(64) NOT NULL,
  "inputHash" VARCHAR(64) NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "responseAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "latencyMs" INTEGER,
  "status" "AiAnalysisStatus" NOT NULL DEFAULT 'RUNNING',
  "evidenceSteps" INTEGER[] NOT NULL,
  "pricing" JSONB NOT NULL,
  "usage" JSONB,
  "estimatedCostUsd" DECIMAL(14,8),
  "result" JSONB,
  "errorCode" VARCHAR(64),
  CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiAnalysis_shopId_runId_fkey" FOREIGN KEY ("shopId", "runId") REFERENCES "TestRun"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AiAnalysis_attempt_check" CHECK ("attempt" BETWEEN 1 AND 3),
  CONSTRAINT "AiAnalysis_cost_check" CHECK ("estimatedCostUsd" >= 0),
  CONSTRAINT "AiAnalysis_latency_check" CHECK ("latencyMs" >= 0),
  CONSTRAINT "AiAnalysis_hash_check" CHECK ("inputHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AiAnalysis_evidence_check" CHECK (
    cardinality("evidenceSteps") BETWEEN 1 AND 3
    AND "evidenceSteps" <@ ARRAY[2,3,5]
    AND array_position("evidenceSteps", NULL) IS NULL
  ),
  CONSTRAINT "AiAnalysis_result_check" CHECK (
    ("status" = 'SUCCEEDED' AND "result" IS NOT NULL AND "errorCode" IS NULL AND "responseAt" IS NOT NULL)
    OR ("status" = 'FAILED' AND "result" IS NULL AND "errorCode" IS NOT NULL)
    OR ("status" = 'RUNNING' AND "result" IS NULL AND "errorCode" IS NULL)
  )
);
CREATE UNIQUE INDEX "AiAnalysis_shopId_runId_attempt_key" ON "AiAnalysis"("shopId", "runId", "attempt");
CREATE INDEX "AiAnalysis_status_expiresAt_idx" ON "AiAnalysis"("status", "expiresAt");
