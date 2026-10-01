import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, TestRun } from '@prisma/client';
import type { AutomationStore, EmailClaim } from '@ghostshopper/application';
import { admitRun } from './billing.js';
import type { BillingPolicy } from '@ghostshopper/domain';
import {
  EMAIL_COOLDOWN_MS,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_WINDOW_MS,
  nextScheduledTime,
  snapshotMonitor,
  type EmailKind,
} from '@ghostshopper/domain';

/** Invoked inside the same monitor-locked transaction as incident reconciliation. */
export async function queueIncidentEmail(
  tx: Prisma.TransactionClient,
  run: TestRun,
  configKey: string,
  kind: EmailKind,
) {
  const channel = await tx.notificationChannel.findFirst({
    where: {
      shopId: run.shopId,
      enabled: true,
      ...(kind === 'RECOVERY' ? { recoveryEnabled: true } : {}),
      shop: { installedAt: { not: null }, uninstalledAt: null },
    },
  });
  if (!channel) return;
  // One message per transition kind/run even if several significant incidents changed.
  await tx.emailDelivery.createMany({
    data: [
      {
        shopId: run.shopId,
        runId: run.id,
        monitorId: run.monitorId,
        configKey,
        kind,
        recipient: channel.email,
        channelVersion: channel.version,
      },
    ],
    skipDuplicates: true,
  });
}

export class PrismaAutomationStore implements AutomationStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly billingPolicy?: BillingPolicy | null,
  ) {}
  async schedule(): Promise<number> {
    return this.db.$transaction(
      async (tx) => {
        const now = new Date();
        const rows = await tx.$queryRaw<{ id: string; shopId: string }[]>`
        SELECT m."id", m."shopId" FROM "Monitor" m JOIN "Shop" s ON s."id" = m."shopId"
        WHERE m."enabled" = true AND m."nextRunAt" <= ${now}
          AND s."installedAt" IS NOT NULL AND s."uninstalledAt" IS NULL
        ORDER BY m."nextRunAt", m."id" LIMIT 50 FOR UPDATE OF m SKIP LOCKED`;
        let created = 0;
        for (const row of rows) {
          const monitor = await tx.monitor.findUniqueOrThrow({ where: { shopId_id: row } });
          const active = await tx.testRun.findFirst({
            where: {
              shopId: row.shopId,
              monitorId: row.id,
              status: { in: ['QUEUED', 'RUNNING', 'COLLECTING', 'ANALYZING'] },
            },
            select: { id: true },
          });
          if (!active) {
            const admission = this.billingPolicy
              ? await admitRun(tx, row.shopId, this.billingPolicy)
              : null;
            if (admission && 'error' in admission) {
              await tx.monitor.update({
                where: { shopId_id: row },
                data: { nextRunAt: new Date(now.getTime() + 300000) },
              });
              continue;
            }
            const run = await tx.testRun.create({
              data: {
                ...snapshotMonitor(monitor),
                shopId: row.shopId,
                monitorId: row.id,
                dispatchRequested: true,
              },
            });
            if (admission)
              await tx.usageRecord.create({
                data: { shopId: row.shopId, runId: run.id, periodKey: admission.periodKey },
              });
            created++;
          }
          await tx.monitor.update({
            where: { shopId_id: row },
            data: {
              nextRunAt: active
                ? new Date(now.getTime() + 60_000)
                : nextScheduledTime(now, monitor.frequency),
            },
          });
        }
        return created;
      },
      { maxWait: 1000, timeout: 10_000 },
    );
  }
  async claimEmail(): Promise<EmailClaim | null> {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "EmailDelivery" WHERE "nextAttemptAt" <= ${now}
          AND ("status" = 'PENDING' OR ("status" = 'SENDING' AND "leaseExpiresAt" <= ${now}))
        ORDER BY "nextAttemptAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const id = rows[0]?.id;
      if (!id) return null;
      const email = await tx.emailDelivery.findUniqueOrThrow({
        where: { id },
        include: {
          shop: { select: { installedAt: true, uninstalledAt: true } },
          run: { include: { monitor: true } },
        },
      });
      const cancel = async (status: 'CANCELLED' | 'FAILED') => {
        await tx.emailDelivery.update({
          where: { id },
          data: { status, finishedAt: now, leaseToken: null, leaseExpiresAt: null },
        });
        return null;
      };
      if (
        email.attemptCount >= EMAIL_MAX_ATTEMPTS ||
        now.getTime() - (email.firstAttemptAt ?? email.createdAt).getTime() >= EMAIL_RETRY_WINDOW_MS
      )
        return cancel('FAILED');
      if (!email.shop.installedAt || email.shop.uninstalledAt) return cancel('CANCELLED');
      const locked = await tx.$queryRaw<{ shopId: string }[]>`
        SELECT "shopId" FROM "NotificationChannel" WHERE "shopId" = ${email.shopId} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) {
        await tx.emailDelivery.update({
          where: { id },
          data: { nextAttemptAt: new Date(now.getTime() + 60_000) },
        });
        return null;
      }
      const channel = await tx.notificationChannel.findUniqueOrThrow({
        where: { shopId: email.shopId },
      });
      const monitor = email.run.monitor;
      if (
        !channel.enabled ||
        channel.version !== email.channelVersion ||
        channel.email !== email.recipient ||
        !monitor.enabled ||
        monitor.productId !== email.run.productId ||
        monitor.variantId !== email.run.variantId ||
        monitor.device !== email.run.device ||
        (email.kind === 'RECOVERY' && !channel.recoveryEnabled)
      )
        return cancel('CANCELLED');
      // Suppress obsolete alerts, including retries whose acceptance was uncertain.
      const open = await tx.incident.count({
        where: {
          shopId: email.shopId,
          monitorId: email.monitorId,
          configKey: email.configKey,
          status: 'OPEN',
          severity: { in: ['HIGH', 'CRITICAL'] },
        },
      });
      if ((email.kind === 'FAILURE' && open === 0) || (email.kind === 'RECOVERY' && open > 0))
        return cancel('CANCELLED');
      if (email.kind === 'RECOVERY') {
        const failure = await tx.emailDelivery.findFirst({
          where: {
            shopId: email.shopId,
            monitorId: email.monitorId,
            configKey: email.configKey,
            kind: 'FAILURE',
            channelVersion: email.channelVersion,
            createdAt: { lte: email.createdAt },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (failure?.status !== 'SENT') return cancel('CANCELLED');
      }
      if (channel.nextSendAt > now) {
        await tx.emailDelivery.update({
          where: { id },
          data: { nextAttemptAt: channel.nextSendAt },
        });
        return null;
      }
      const token = randomUUID();
      await tx.emailDelivery.update({
        where: { id },
        data: {
          status: 'SENDING',
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + 60_000),
          firstAttemptAt: email.firstAttemptAt ?? now,
          attemptCount: { increment: 1 },
        },
      });
      await tx.notificationChannel.update({
        where: { shopId: email.shopId },
        data: { nextSendAt: new Date(now.getTime() + EMAIL_COOLDOWN_MS) },
      });
      return {
        id,
        token,
        shopId: email.shopId,
        runId: email.runId,
        recipient: email.recipient,
        kind: email.kind,
      };
    });
  }
  async finishEmail(claim: EmailClaim, result: 'ACCEPTED' | 'RETRY' | 'REJECTED') {
    const now = new Date();
    await this.db.emailDelivery.updateMany({
      where: { id: claim.id, shopId: claim.shopId, status: 'SENDING', leaseToken: claim.token },
      data: {
        status: result === 'ACCEPTED' ? 'SENT' : result === 'RETRY' ? 'PENDING' : 'FAILED',
        leaseToken: null,
        leaseExpiresAt: null,
        ...(result === 'RETRY'
          ? { nextAttemptAt: new Date(now.getTime() + EMAIL_COOLDOWN_MS) }
          : { finishedAt: now }),
      },
    });
  }
}
