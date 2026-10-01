import { describe, expect, it, vi } from 'vitest';
import { reconcileIncidents } from '../../packages/database/src/incidents.js';
type TestRun = Parameters<typeof reconcileIncidents>[1];
type TransactionClient = Parameters<typeof reconcileIncidents>[0];
const run = {
  id: 'run',
  shopId: 'shop',
  monitorId: 'monitor',
  attemptCount: 1,
  createdAt: new Date(100),
  device: 'DESKTOP',
  scenario: 'PURCHASE_JOURNEY',
  productId: 'p',
  variantId: null,
  outcome: 'FAILED',
} as TestRun;
const finding = {
  id: 'finding',
  fingerprint: 'a'.repeat(64),
  type: 'ADD_TO_CART_FAILURE',
  severity: 'CRITICAL',
  title: 'Cart failed',
  description: 'Cart failed',
};
function fixture() {
  const tx = {
    notificationChannel: { findFirst: vi.fn().mockResolvedValue(null) },
    emailDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    runAnalysis: {
      findUnique: vi.fn().mockResolvedValue({
        complete: true,
        outcome: 'FAILED',
        rulesVersion: 'technical-v1',
        findings: [finding],
      }),
    },
    incidentScope: {
      upsert: vi.fn().mockResolvedValue({
        lastCleanRunId: null,
        lastCleanRunCreatedAt: null,
        lastCleanCompletedAt: null,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    incident: {
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockResolvedValue({
        id: 'incident',
        occurrenceCount: 0,
        lastSeenRunId: run.id,
        lastSeenRunCreatedAt: run.createdAt,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    incidentOccurrence: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return {
    tx,
    reconcile: (input = run) => reconcileIncidents(tx as unknown as TransactionClient, input),
  };
}
describe('incident reconciliation queries', () => {
  it('records one failure intent for an opted-in shop, not another for repeated findings', async () => {
    const f = fixture();
    f.tx.notificationChannel.findFirst.mockResolvedValue({
      email: 'owner@example.com',
      version: 2,
    });
    await f.reconcile();
    expect(f.tx.emailDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          shopId: run.shopId,
          runId: run.id,
          kind: 'FAILURE',
          channelVersion: 2,
        }),
      ],
      skipDuplicates: true,
    });
    f.tx.emailDelivery.createMany.mockClear();
    f.tx.incident.upsert.mockResolvedValue({
      id: 'incident',
      occurrenceCount: 3,
      status: 'OPEN',
      lastSeenRunId: 'previous',
      lastSeenRunCreatedAt: new Date(50),
    });
    await f.reconcile();
    expect(f.tx.emailDelivery.createMany).not.toHaveBeenCalled();
  });
  it('records recovery intent only when a significant incident actually resolves', async () => {
    const f = fixture();
    f.tx.notificationChannel.findFirst.mockResolvedValue({
      email: 'owner@example.com',
      version: 1,
    });
    f.tx.incident.count.mockResolvedValue(1);
    f.tx.runAnalysis.findUnique.mockResolvedValue({
      complete: true,
      outcome: 'PASSED',
      rulesVersion: 'technical-v1',
      findings: [],
    });
    await f.reconcile({ ...run, outcome: 'PASSED' });
    expect(f.tx.emailDelivery.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ kind: 'RECOVERY' })],
      skipDuplicates: true,
    });
    expect(f.tx.notificationChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recoveryEnabled: true,
          shopId: run.shopId,
          enabled: true,
        }) as unknown,
      }),
    );
  });
  it('opens a finding incident and counts a distinct run rather than raw diagnostic events', async () => {
    const f = fixture();
    await f.reconcile();
    expect(f.tx.incident.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          shopId: 'shop',
          monitorId: 'monitor',
          fingerprint: finding.fingerprint,
          status: 'OPEN',
        }) as unknown,
      }),
    );
    expect(f.tx.incidentOccurrence.createMany).toHaveBeenCalledWith({
      data: [
        { shopId: 'shop', incidentId: 'incident', runId: 'run', attempt: 1, findingId: 'finding' },
      ],
      skipDuplicates: true,
    });
    expect(f.tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          occurrenceCount: { increment: 1 },
          status: 'OPEN',
        }) as unknown,
      }),
    );
  });
  it('does not count duplicate occurrences again', async () => {
    const f = fixture();
    f.tx.incidentOccurrence.createMany.mockResolvedValue({ count: 0 });
    await f.reconcile();
    expect(f.tx.incident.update).not.toHaveBeenCalled();
  });
  it('records a late failure as already resolved after a newer clean observation', async () => {
    const f = fixture();
    f.tx.incidentScope.upsert.mockResolvedValue({
      lastCleanRunId: 'clean',
      lastCleanRunCreatedAt: new Date(200),
      lastCleanCompletedAt: new Date(300),
    });
    await f.reconcile();
    expect(f.tx.incident.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'RESOLVED', resolvedRunId: 'clean' }) as unknown,
      }),
    );
    expect(f.tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          occurrenceCount: { increment: 1 },
          status: 'RESOLVED',
        }) as unknown,
      }),
    );
  });
  it('counts an older failure without overwriting the latest incident state', async () => {
    const f = fixture();
    f.tx.incident.upsert.mockResolvedValue({
      id: 'incident',
      occurrenceCount: 2,
      lastSeenRunId: 'newer',
      lastSeenRunCreatedAt: new Date(200),
    });
    await f.reconcile();
    expect(f.tx.incident.update).toHaveBeenCalledWith({
      where: { shopId_id: { shopId: 'shop', id: 'incident' } },
      data: { occurrenceCount: { increment: 1 } },
    });
  });
  it('reopens an existing incident when the finding is newer than the clean run', async () => {
    const f = fixture();
    f.tx.incidentScope.upsert.mockResolvedValue({
      lastCleanRunId: 'clean',
      lastCleanRunCreatedAt: new Date(50),
      lastCleanCompletedAt: new Date(60),
    });
    f.tx.incident.upsert.mockResolvedValue({
      id: 'incident',
      occurrenceCount: 2,
      lastSeenRunId: 'old',
      lastSeenRunCreatedAt: new Date(30),
    });
    await f.reconcile();
    expect(f.tx.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'OPEN',
          resolvedAt: null,
          resolvedRunId: null,
          occurrenceCount: { increment: 1 },
        }) as unknown,
      }),
    );
  });
  it('resolves only older incidents in the same configuration on a clean pass', async () => {
    const f = fixture();
    f.tx.runAnalysis.findUnique.mockResolvedValue({
      complete: true,
      outcome: 'PASSED',
      rulesVersion: 'technical-v1',
      findings: [],
    });
    await f.reconcile({ ...run, outcome: 'PASSED' });
    expect(f.tx.incident.updateMany).toHaveBeenCalledWith({
      where: {
        shopId: 'shop',
        monitorId: 'monitor',
        configKey: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
        status: 'OPEN',
        OR: [
          { lastSeenRunCreatedAt: { lt: run.createdAt } },
          { lastSeenRunCreatedAt: run.createdAt, lastSeenRunId: { lt: 'run' } },
        ],
      },
      data: { status: 'RESOLVED', resolvedAt: expect.any(Date) as unknown, resolvedRunId: 'run' },
    });
    expect(f.tx.incidentOccurrence.createMany).not.toHaveBeenCalled();
  });
  it.each(['incomplete', 'warning', 'missing', 'older'] as const)(
    'does not resolve on %s observations',
    async (mode) => {
      const f = fixture();
      f.tx.runAnalysis.findUnique.mockResolvedValue(
        mode === 'missing'
          ? null
          : {
              complete: mode !== 'incomplete',
              outcome: mode === 'warning' ? 'WARNING' : 'PASSED',
              rulesVersion: 'technical-v1',
              findings: [],
            },
      );
      if (mode === 'older')
        f.tx.incidentScope.upsert.mockResolvedValue({
          lastCleanRunId: 'newer',
          lastCleanRunCreatedAt: new Date(200),
          lastCleanCompletedAt: new Date(300),
        });
      await f.reconcile({ ...run, outcome: mode === 'warning' ? 'WARNING' : 'PASSED' });
      expect(f.tx.incident.updateMany).not.toHaveBeenCalled();
    },
  );
});
