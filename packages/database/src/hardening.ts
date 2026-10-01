import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
export class PrismaRateLimiter {
  constructor(private readonly db: PrismaClient) {}
  async take(shop: string, group: string, limit: number): Promise<boolean> {
    const key = createHash('sha256').update(`${shop}:${group}`).digest('hex');
    const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000);
    const result = await this.db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" = EXCLUDED."windowStart" THEN LEAST("RateLimitBucket"."count" + 1, ${limit + 1}) ELSE 1 END,
        "windowStart" = EXCLUDED."windowStart"
      RETURNING "count"`;
    return !!result[0] && result[0].count <= limit;
  }
}
export class PrismaMaintenance {
  constructor(private readonly db: PrismaClient) {}
  async claimDeletion() {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const rows = await tx.$queryRaw<
        { storageKey: string }[]
      >`SELECT "storageKey" FROM "ArtifactDeletion"
        WHERE "nextAttemptAt" <= ${now} AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now})
        ORDER BY "nextAttemptAt", "storageKey" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const key = rows[0]?.storageKey;
      if (!key) return null;
      const token = randomUUID();
      const row = await tx.artifactDeletion.update({
        where: { storageKey: key },
        data: {
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + 60000),
          attempts: { increment: 1 },
        },
      });
      return { key, token, attempts: row.attempts };
    });
  }
  async finishDeletion(claim: { key: string; token: string; attempts: number }, success: boolean) {
    const where = { storageKey: claim.key, leaseToken: claim.token };
    if (success) await this.db.artifactDeletion.deleteMany({ where });
    else
      await this.db.artifactDeletion.updateMany({
        where,
        data: {
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: 'OBJECT_DELETE_FAILED',
          nextAttemptAt: new Date(
            Date.now() + Math.min(21600000, 60000 * 2 ** Math.min(claim.attempts, 9)),
          ),
        },
      });
  }
  async prune() {
    const before = new Date(Date.now() - 86400000);
    await this.db
      .$executeRaw`DELETE FROM "ServiceHeartbeat" WHERE "id" IN (SELECT "id" FROM "ServiceHeartbeat" WHERE "updatedAt" < ${before} LIMIT 100)`;
    // Bound every deletion batch; run/usage records are never pruned here.
    await this.db
      .$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (SELECT "key" FROM "RateLimitBucket" WHERE "windowStart" < ${before} LIMIT 500)`;
    const emailBefore = new Date(Date.now() - 90 * 86400000);
    await this.db
      .$executeRaw`DELETE FROM "EmailDelivery" WHERE "id" IN (SELECT "id" FROM "EmailDelivery"
      WHERE "status" IN ('SENT', 'FAILED', 'CANCELLED') AND "finishedAt" < ${emailBefore} LIMIT 100)`;
  }
  async heartbeat(id: string) {
    await this.db.serviceHeartbeat.upsert({
      where: { id },
      create: { id, updatedAt: new Date() },
      update: { updatedAt: new Date() },
    });
  }
}
