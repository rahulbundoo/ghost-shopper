import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { RunClaim, RunStore, ClaimResult } from '@ghostshopper/application';
import {
  actionResultSchema,
  runMonitorJobSchema,
  validate,
  type RunMonitorJob,
} from '@ghostshopper/contracts';
import {
  assertRunTransition,
  isTerminalRun,
  MAX_RUN_ATTEMPTS,
  type RunErrorCode,
  type RunOutcome,
  type RunStatus,
  type ActionResult,
} from '@ghostshopper/domain';
import { publicRunSelection } from './run-selection.js';
import { reconcileIncidents } from './incidents.js';

export class PrismaRunStore implements RunStore {
  constructor(private readonly db: PrismaClient) {}

  async recordStep(claim: RunClaim, input: ActionResult): Promise<boolean> {
    const result = validate(actionResultSchema, input);
    return this.db.$transaction(async (tx) => {
      // The conditional UPDATE locks the parent until the step insert commits.
      const locked = await tx.testRun.updateMany({
        where: {
          id: claim.run.id,
          shopId: claim.run.shopId,
          leaseToken: claim.token,
          leaseExpiresAt: { gt: new Date() },
          status: 'RUNNING',
          attemptCount: claim.attempt,
        },
        data: { status: 'RUNNING' },
      });
      if (locked.count !== 1) return false;
      await tx.runStep.createMany({
        data: [
          { ...result, shopId: claim.run.shopId, runId: claim.run.id, attempt: claim.attempt },
        ],
        skipDuplicates: true,
      });
      return true;
    });
  }

  async pending(limit: number): Promise<RunMonitorJob[]> {
    const now = new Date();
    const rows = await this.db.testRun.findMany({
      where: {
        dispatchRequested: true,
        status: { in: ['QUEUED', 'RUNNING', 'COLLECTING', 'ANALYZING'] },
        nextDispatchAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      select: { id: true, shopId: true },
      orderBy: [{ nextDispatchAt: 'asc' }, { id: 'asc' }],
      take: Math.max(1, Math.min(100, limit)),
    });
    return rows.map((row) => ({ version: 1, shopId: row.shopId, runId: row.id }));
  }
  async dispatched(input: RunMonitorJob): Promise<void> {
    const job = validate(runMonitorJobSchema, input);
    await this.db.testRun.updateMany({
      where: { id: job.runId, shopId: job.shopId, dispatchRequested: true },
      data: { nextDispatchAt: new Date(Date.now() + 60_000) },
    });
  }
  async claim(input: RunMonitorJob, leaseMs: number): Promise<ClaimResult> {
    const job = validate(runMonitorJobSchema, input);
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 330_000)
      throw new Error('INVALID_LEASE_DURATION');
    return this.db.$transaction(
      async (tx) => {
        const now = new Date();
        const run = await tx.testRun.findFirst({
          where: { id: job.runId, shopId: job.shopId },
          include: {
            shop: { select: { installedAt: true, uninstalledAt: true } },
            monitor: { select: { enabled: true } },
          },
        });
        if (!run || !run.dispatchRequested || isTerminalRun(run.status)) return { kind: 'ignored' };
        if (run.leaseExpiresAt && run.leaseExpiresAt > now) return { kind: 'busy' };
        const code =
          !run.shop.installedAt || run.shop.uninstalledAt
            ? 'SHOP_INACTIVE'
            : !run.monitor.enabled
              ? 'MONITOR_DISABLED'
              : run.attemptCount >= MAX_RUN_ATTEMPTS
                ? 'ATTEMPTS_EXHAUSTED'
                : null;
        if (code) {
          const status = code === 'ATTEMPTS_EXHAUSTED' ? 'ERROR' : 'CANCELLED';
          assertRunTransition(run.status, status, status);
          await tx.testRun.update({
            where: { shopId_id: { shopId: job.shopId, id: job.runId } },
            data: {
              status,
              outcome: status,
              finishedAt: now,
              errorCode: code,
              dispatchRequested: false,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          return { kind: 'ignored' };
        }
        if (run.status === 'QUEUED') assertRunTransition(run.status, 'RUNNING');
        // Expired attempts are recovered under a fresh fencing token; terminal runs never restart.
        const token = randomUUID();
        const claimed = await tx.testRun.update({
          where: { shopId_id: { shopId: job.shopId, id: job.runId } },
          data: {
            status: 'RUNNING',
            outcome: null,
            startedAt: now,
            finishedAt: null,
            errorCode: null,
            attemptCount: { increment: 1 },
            leaseToken: token,
            leaseExpiresAt: new Date(now.getTime() + leaseMs),
          },
          select: publicRunSelection,
        });
        return { kind: 'claimed', claim: { run: claimed, token, attempt: claimed.attemptCount } };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async advance(
    claim: RunClaim,
    from: RunStatus,
    to: RunStatus,
    outcome?: RunOutcome,
  ): Promise<boolean> {
    assertRunTransition(from, to, outcome ?? null);
    if (to === 'COMPLETED') {
      return this.db.$transaction(
        async (tx) => {
          // Serialize completions for a monitor, including distinct overlapping runs.
          // Parameterized row lock does not alter configuration, version or updatedAt.
          const monitors = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM "Monitor" WHERE "shopId" = ${claim.run.shopId} AND "id" = ${claim.run.monitorId}::uuid FOR UPDATE`;
          if (monitors.length !== 1) return false;
          const completed = await tx.testRun.updateMany({
            where: {
              id: claim.run.id,
              shopId: claim.run.shopId,
              attemptCount: claim.attempt,
              leaseToken: claim.token,
              leaseExpiresAt: { gt: new Date() },
              status: from,
            },
            data: {
              status: 'COMPLETED',
              outcome: outcome ?? null,
              finishedAt: new Date(),
              dispatchRequested: false,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (completed.count !== 1) return false;
          const run = await tx.testRun.findUniqueOrThrow({
            where: { shopId_id: { shopId: claim.run.shopId, id: claim.run.id } },
          });
          await reconcileIncidents(tx, run);
          return true;
        },
        { maxWait: 1000, timeout: 5000 },
      );
    }
    const terminal = isTerminalRun(to);
    const result = await this.db.testRun.updateMany({
      where: {
        id: claim.run.id,
        shopId: claim.run.shopId,
        leaseToken: claim.token,
        leaseExpiresAt: { gt: new Date() },
        status: from,
      },
      data: {
        status: to,
        outcome: outcome ?? null,
        ...(terminal
          ? {
              finishedAt: new Date(),
              dispatchRequested: false,
              leaseToken: null,
              leaseExpiresAt: null,
            }
          : {}),
      },
    });
    return result.count === 1;
  }
  async fail(claim: RunClaim, code: RunErrorCode, retry: boolean): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const where = {
        id: claim.run.id,
        shopId: claim.run.shopId,
        leaseToken: claim.token,
        leaseExpiresAt: { gt: new Date() },
      };
      const current = await tx.testRun.findFirst({ where });
      if (!current || isTerminalRun(current.status)) return false;
      const shouldRetry = retry && current.attemptCount < MAX_RUN_ATTEMPTS;
      assertRunTransition(
        current.status,
        shouldRetry ? 'QUEUED' : 'ERROR',
        shouldRetry ? null : 'ERROR',
      );
      const updated = await tx.testRun.updateMany({
        where: { ...where, status: current.status },
        data: shouldRetry
          ? {
              status: 'QUEUED',
              outcome: null,
              startedAt: null,
              finishedAt: null,
              errorCode: code,
              leaseToken: null,
              leaseExpiresAt: null,
              nextDispatchAt: new Date(Date.now() + 60_000),
            }
          : {
              status: 'ERROR',
              outcome: 'ERROR',
              finishedAt: new Date(),
              errorCode: code,
              dispatchRequested: false,
              leaseToken: null,
              leaseExpiresAt: null,
            },
      });
      return updated.count === 1;
    });
  }
}
