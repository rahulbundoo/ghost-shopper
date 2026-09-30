CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE UNIQUE INDEX "Finding_shopId_runId_attempt_id_key" ON "Finding" ("shopId", "runId", "attempt", "id");
CREATE TABLE "IncidentScope" (
  "shopId" TEXT NOT NULL, "monitorId" UUID NOT NULL, "configKey" VARCHAR(64) NOT NULL,
  "lastCleanRunCreatedAt" TIMESTAMP(3), "lastCleanRunId" UUID, "lastCleanCompletedAt" TIMESTAMP(3),
  CONSTRAINT "IncidentScope_pkey" PRIMARY KEY ("shopId", "monitorId", "configKey"),
  CONSTRAINT "IncidentScope_shopId_monitorId_fkey" FOREIGN KEY ("shopId", "monitorId") REFERENCES "Monitor" ("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IncidentScope_valid" CHECK ("configKey" ~ '^[a-f0-9]{64}$' AND ("lastCleanRunCreatedAt" IS NULL) = ("lastCleanRunId" IS NULL) AND ("lastCleanRunId" IS NULL) = ("lastCleanCompletedAt" IS NULL))
);
CREATE TABLE "Incident" (
  "id" UUID NOT NULL, "shopId" TEXT NOT NULL, "monitorId" UUID NOT NULL, "configKey" VARCHAR(64) NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL, "type" "FindingType" NOT NULL, "severity" "Severity" NOT NULL,
  "title" VARCHAR(120) NOT NULL, "description" VARCHAR(500) NOT NULL, "status" "IncidentStatus" NOT NULL,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 0, "firstSeenAt" TIMESTAMP(3) NOT NULL, "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenRunId" UUID NOT NULL, "lastSeenRunCreatedAt" TIMESTAMP(3) NOT NULL, "resolvedAt" TIMESTAMP(3), "resolvedRunId" UUID,
  CONSTRAINT "Incident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Incident_shopId_monitorId_configKey_fkey" FOREIGN KEY ("shopId", "monitorId", "configKey") REFERENCES "IncidentScope" ("shopId", "monitorId", "configKey") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Incident_shopId_lastSeenRunId_fkey" FOREIGN KEY ("shopId", "lastSeenRunId") REFERENCES "TestRun" ("shopId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "Incident_shopId_resolvedRunId_fkey" FOREIGN KEY ("shopId", "resolvedRunId") REFERENCES "TestRun" ("shopId", "id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "Incident_valid" CHECK ("fingerprint" ~ '^[a-f0-9]{64}$' AND "configKey" ~ '^[a-f0-9]{64}$' AND "occurrenceCount" >= 0 AND "lastSeenAt" >= "firstSeenAt" AND (("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedRunId" IS NULL) OR ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "resolvedRunId" IS NOT NULL)))
);
CREATE UNIQUE INDEX "Incident_shopId_id_key" ON "Incident" ("shopId", "id");
CREATE UNIQUE INDEX "Incident_shopId_monitorId_configKey_fingerprint_key" ON "Incident" ("shopId", "monitorId", "configKey", "fingerprint");
CREATE INDEX "Incident_shopId_status_lastSeenAt_id_idx" ON "Incident" ("shopId", "status", "lastSeenAt", "id");
CREATE INDEX "Incident_shopId_monitorId_status_idx" ON "Incident" ("shopId", "monitorId", "status");
CREATE TABLE "IncidentOccurrence" (
  "id" UUID NOT NULL, "shopId" TEXT NOT NULL, "incidentId" UUID NOT NULL, "runId" UUID NOT NULL,
  "attempt" INTEGER NOT NULL, "findingId" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncidentOccurrence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IncidentOccurrence_shopId_incidentId_fkey" FOREIGN KEY ("shopId", "incidentId") REFERENCES "Incident" ("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IncidentOccurrence_shopId_runId_fkey" FOREIGN KEY ("shopId", "runId") REFERENCES "TestRun" ("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IncidentOccurrence_shopId_runId_attempt_findingId_fkey" FOREIGN KEY ("shopId", "runId", "attempt", "findingId") REFERENCES "Finding" ("shopId", "runId", "attempt", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IncidentOccurrence_attempt" CHECK ("attempt" BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX "IncidentOccurrence_shopId_incidentId_runId_key" ON "IncidentOccurrence" ("shopId", "incidentId", "runId");
CREATE UNIQUE INDEX "IncidentOccurrence_shopId_findingId_key" ON "IncidentOccurrence" ("shopId", "findingId");
CREATE INDEX "IncidentOccurrence_shopId_incidentId_createdAt_id_idx" ON "IncidentOccurrence" ("shopId", "incidentId", "createdAt", "id");
