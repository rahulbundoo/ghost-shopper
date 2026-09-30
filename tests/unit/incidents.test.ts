import { describe, expect, it, vi } from 'vitest';
import {
  canResolveIncidents,
  incidentScopeIdentity,
  isLaterObservation,
  type TestRun,
} from '../../packages/domain/src/index.js';
import { listIncidentsSchema } from '../../packages/contracts/src/index.js';
import { PrismaRunStore, type PrismaClient } from '../../packages/database/src/index.js';
import type { RunClaim } from '../../packages/application/src/index.js';

describe('incident lifecycle rules', () => {
  it('resolves only a complete clean pass', () => {
    expect(canResolveIncidents({ complete: true, outcome: 'PASSED', findings: [] })).toBe(true);
    for (const outcome of ['FAILED', 'WARNING'] as const)
      expect(canResolveIncidents({ complete: true, outcome, findings: [] })).toBe(false);
    expect(canResolveIncidents({ complete: false, outcome: 'PASSED', findings: [] })).toBe(false);
  });
  it('orders observations by immutable request time and UUID, not completion time', () => {
    const current = { createdAt: new Date(100), id: 'b' };
    expect(isLaterObservation(current, null)).toBe(true);
    expect(isLaterObservation(current, current)).toBe(false);
    expect(isLaterObservation({ ...current, id: 'c' }, current)).toBe(true);
    expect(isLaterObservation({ ...current, id: 'a' }, current)).toBe(false);
    expect(isLaterObservation({ createdAt: new Date(99), id: 'z' }, current)).toBe(false);
    expect(isLaterObservation({ createdAt: new Date(101), id: 'a' }, current)).toBe(true);
  });
  it('isolates recovery by monitored configuration and rules version', () => {
    const run = {
      shopId: 'shop',
      monitorId: 'monitor',
      device: 'DESKTOP',
      productId: 'product',
      variantId: null,
      scenario: 'PURCHASE_JOURNEY',
    } as TestRun;
    const key = incidentScopeIdentity(run, 'technical-v1');
    expect(
      incidentScopeIdentity({ ...run, id: 'another-run', monitorVersion: 20 }, 'technical-v1'),
    ).toBe(key);
    expect(incidentScopeIdentity(run, 'technical-v2')).not.toBe(key);
    for (const change of [
      { shopId: 'other' },
      { monitorId: 'other' },
      { device: 'MOBILE' as const },
      { productId: 'other' },
      { variantId: 'other' },
    ])
      expect(incidentScopeIdentity({ ...run, ...change }, 'technical-v1')).not.toBe(key);
  });
  it('rejects caller tenancy, arbitrary status and unbounded lists', () => {
    expect(listIncidentsSchema.parse({})).toEqual({ limit: 25, offset: 0 });
    for (const input of [{ shopId: 'forged' }, { status: 'MUTED' }, { limit: 101 }, { offset: -1 }])
      expect(listIncidentsSchema.safeParse(input).success).toBe(false);
  });
});

describe('atomic completion incident boundary', () => {
  const claim = {
    run: {
      id: '57e735d9-220b-4be1-8fda-fda1c7a71ab5',
      shopId: 'test.myshopify.com',
      monitorId: '0246091e-d6bc-42b8-a31a-ea073bb7b360',
    },
    token: 'lease',
    attempt: 1,
  } as RunClaim;
  function fixture() {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: claim.run.monitorId }]),
      testRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...claim.run, attemptCount: 1, outcome: 'PASSED' }),
      },
      runAnalysis: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const transaction = vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
    return {
      tx,
      transaction,
      store: new PrismaRunStore({ $transaction: transaction } as unknown as PrismaClient),
    };
  }
  it('locks the monitor before fencing completion and reads analysis inside the same transaction', async () => {
    const f = fixture();
    expect(await f.store.advance(claim, 'ANALYZING', 'COMPLETED', 'PASSED')).toBe(true);
    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.testRun.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(f.tx.testRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: claim.run.id,
          shopId: claim.run.shopId,
          attemptCount: 1,
          leaseToken: 'lease',
          leaseExpiresAt: { gt: expect.any(Date) as unknown },
          status: 'ANALYZING',
        },
      }),
    );
    expect(f.tx.runAnalysis.findUnique).toHaveBeenCalledTimes(1);
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });
  it('does not touch incidents when completion loses the lease or is delivered again', async () => {
    const f = fixture();
    f.tx.testRun.updateMany.mockResolvedValue({ count: 0 });
    expect(await f.store.advance(claim, 'ANALYZING', 'COMPLETED', 'PASSED')).toBe(false);
    expect(f.tx.runAnalysis.findUnique).not.toHaveBeenCalled();
  });
  it('propagates incident reconciliation errors so the transaction cannot commit completion', async () => {
    const f = fixture();
    f.tx.runAnalysis.findUnique.mockRejectedValue(new Error('incident-write-failed'));
    await expect(f.store.advance(claim, 'ANALYZING', 'COMPLETED', 'PASSED')).rejects.toThrow(
      'incident-write-failed',
    );
  });
});
