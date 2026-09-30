import { createHash } from 'node:crypto';
import type { Prisma, TestRun } from '@prisma/client';
import {
  canResolveIncidents,
  incidentScopeIdentity,
  isLaterObservation,
} from '@ghostshopper/domain';

/** Caller must hold the monitor lock and complete the run in this same transaction. */
export async function reconcileIncidents(tx: Prisma.TransactionClient, run: TestRun) {
  const analysis = await tx.runAnalysis.findUnique({
    where: {
      shopId_runId_attempt: { shopId: run.shopId, runId: run.id, attempt: run.attemptCount },
    },
    include: { findings: { orderBy: { fingerprint: 'asc' }, take: 88 } },
  });
  // Historical/synthetic runs without deterministic analysis cannot establish recovery.
  if (!analysis) return;
  if (analysis.outcome !== run.outcome) throw new Error('INCIDENT_OUTCOME_MISMATCH');
  const configKey = createHash('sha256')
    .update(incidentScopeIdentity(run, analysis.rulesVersion))
    .digest('hex');
  const scopeKey = { shopId: run.shopId, monitorId: run.monitorId, configKey };
  const scope = await tx.incidentScope.upsert({
    where: { shopId_monitorId_configKey: scopeKey },
    create: scopeKey,
    update: {},
  });
  const order = { createdAt: run.createdAt, id: run.id };
  const cleanOrder =
    scope.lastCleanRunCreatedAt && scope.lastCleanRunId
      ? { createdAt: scope.lastCleanRunCreatedAt, id: scope.lastCleanRunId }
      : null;
  const now = new Date();
  if (canResolveIncidents(analysis) && isLaterObservation(order, cleanOrder)) {
    await tx.incidentScope.update({
      where: { shopId_monitorId_configKey: scopeKey },
      data: {
        lastCleanRunCreatedAt: run.createdAt,
        lastCleanRunId: run.id,
        lastCleanCompletedAt: now,
      },
    });
    // An older successful run cannot resolve a newer observed failure.
    await tx.incident.updateMany({
      where: {
        ...scopeKey,
        status: 'OPEN',
        OR: [
          { lastSeenRunCreatedAt: { lt: run.createdAt } },
          { lastSeenRunCreatedAt: run.createdAt, lastSeenRunId: { lt: run.id } },
        ],
      },
      data: { status: 'RESOLVED', resolvedAt: now, resolvedRunId: run.id },
    });
  }
  for (const finding of analysis.findings) {
    const key = { ...scopeKey, fingerprint: finding.fingerprint };
    const recovered = !isLaterObservation(order, cleanOrder);
    const incident = await tx.incident.upsert({
      where: { shopId_monitorId_configKey_fingerprint: key },
      update: {},
      create: {
        ...key,
        type: finding.type,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        status: recovered ? 'RESOLVED' : 'OPEN',
        firstSeenAt: now,
        lastSeenAt: now,
        lastSeenRunId: run.id,
        lastSeenRunCreatedAt: run.createdAt,
        resolvedAt: recovered ? scope.lastCleanCompletedAt : null,
        resolvedRunId: recovered ? scope.lastCleanRunId : null,
      },
    });
    const occurrence = await tx.incidentOccurrence.createMany({
      data: [
        {
          shopId: run.shopId,
          incidentId: incident.id,
          runId: run.id,
          attempt: run.attemptCount,
          findingId: finding.id,
        },
      ],
      skipDuplicates: true,
    });
    if (occurrence.count !== 1) continue;
    const latest =
      isLaterObservation(order, {
        createdAt: incident.lastSeenRunCreatedAt,
        id: incident.lastSeenRunId,
      }) || incident.occurrenceCount === 0;
    await tx.incident.update({
      where: { shopId_id: { shopId: run.shopId, id: incident.id } },
      data: {
        occurrenceCount: { increment: 1 },
        ...(latest
          ? {
              lastSeenAt: now,
              lastSeenRunId: run.id,
              lastSeenRunCreatedAt: run.createdAt,
              severity: finding.severity,
              title: finding.title,
              description: finding.description,
              status: recovered ? 'RESOLVED' : 'OPEN',
              resolvedAt: recovered ? scope.lastCleanCompletedAt : null,
              resolvedRunId: recovered ? scope.lastCleanRunId : null,
            }
          : {}),
      },
    });
  }
}
