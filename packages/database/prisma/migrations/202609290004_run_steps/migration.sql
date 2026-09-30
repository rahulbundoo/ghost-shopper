CREATE TYPE "JourneyActionName" AS ENUM ('OPEN_HOME', 'FIND_PRODUCT', 'OPEN_PRODUCT', 'SELECT_VARIANT', 'ADD_TO_CART', 'OPEN_CART', 'BEGIN_CHECKOUT');
CREATE TYPE "StepStatus" AS ENUM ('PASSED', 'FAILED', 'SKIPPED');
CREATE TYPE "StepErrorCode" AS ENUM ('PAGE_UNAVAILABLE', 'PRODUCT_NOT_FOUND', 'VARIANT_UNAVAILABLE', 'VARIANT_SELECTOR_FAILURE', 'ADD_TO_CART_FAILURE', 'CART_FAILURE', 'CHECKOUT_FAILURE', 'ACTION_TIMEOUT', 'UNSAFE_NAVIGATION', 'RUN_ABORTED', 'PREVIOUS_STEP_FAILED');
CREATE TABLE "RunStep" (
  "id" UUID NOT NULL, "shopId" TEXT NOT NULL, "runId" UUID NOT NULL,
  "attempt" INTEGER NOT NULL, "action" "JourneyActionName" NOT NULL, "position" INTEGER NOT NULL,
  "status" "StepStatus" NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3) NOT NULL,
  "durationMs" INTEGER NOT NULL, "currentUrl" VARCHAR(2048), "errorCode" "StepErrorCode", "errorMessage" VARCHAR(240),
  CONSTRAINT "RunStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RunStep_shopId_runId_fkey" FOREIGN KEY ("shopId", "runId") REFERENCES "TestRun" ("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RunStep_bounds" CHECK ("attempt" BETWEEN 1 AND 3 AND "position" BETWEEN 0 AND 6 AND "durationMs" BETWEEN 0 AND 300000 AND "finishedAt" >= "startedAt"),
  CONSTRAINT "RunStep_outcome" CHECK (("status" = 'PASSED' AND "errorCode" IS NULL AND "errorMessage" IS NULL) OR ("status" <> 'PASSED' AND "errorCode" IS NOT NULL AND "errorMessage" IS NOT NULL))
);
CREATE UNIQUE INDEX "RunStep_shopId_runId_attempt_position_key" ON "RunStep" ("shopId", "runId", "attempt", "position");
