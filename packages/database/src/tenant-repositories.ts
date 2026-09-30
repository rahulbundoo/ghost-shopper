import { Prisma, type PrismaClient } from '@prisma/client';
import { publicRunSelection } from './run-selection.js';
import { mapAiAnalysis } from './ai.js';
import { publicArtifactSelection } from './artifacts.js';
import type { TenantRepositories } from '@ghostshopper/application';
import { assertShopActive, DomainError, snapshotMonitor, type Shop } from '@ghostshopper/domain';
import {
  createMonitorSchema,
  entityIdSchema,
  listTestRunsSchema,
  listIncidentsSchema,
  paginationSchema,
  shopDomainSchema,
  updateMonitorSchema,
  validate,
} from '@ghostshopper/contracts';

const shopSelection = {
  id: true,
  shopifyId: true,
  name: true,
  storefrontUrl: true,
  currencyCode: true,
  installedAt: true,
  uninstalledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ShopSelect;

/** Server-only factory: pass session.shop from Shopify authentication, never request input. */
export function createTenantRepositories(
  db: PrismaClient,
  authenticatedShop: string,
): TenantRepositories {
  const shopId = validate(shopDomainSchema, authenticatedShop);

  async function activeTransaction<T>(
    operation: (tx: Prisma.TransactionClient, shop: Shop) => Promise<T>,
  ): Promise<T> {
    // Retry only transaction conflicts, never validation/tenant failures or arbitrary database errors.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.$transaction(
          async (tx) => {
            const shop = await tx.shop.findUnique({ where: { id: shopId }, select: shopSelection });
            assertShopActive(shop);
            return operation(tx, shop);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034')
          throw error;
        if (attempt === 2) throw new DomainError('CONFLICT');
      }
    }
    throw new DomainError('CONFLICT');
  }

  return {
    aiAnalyses: {
      list: (input) => {
        const runId = validate(entityIdSchema, input);
        return activeTransaction(async (tx) =>
          (
            await tx.aiAnalysis.findMany({
              where: { shopId, runId },
              orderBy: { attempt: 'asc' },
              take: 3,
            })
          ).map(mapAiAnalysis),
        );
      },
    },
    incidents: {
      list: (input) => {
        const { limit, offset, monitorId, status } = validate(listIncidentsSchema, input);
        return activeTransaction((tx) =>
          tx.incident.findMany({
            where: { shopId, ...(monitorId ? { monitorId } : {}), ...(status ? { status } : {}) },
            orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
            take: limit,
            skip: offset,
          }),
        );
      },
      get: (input) => {
        const id = validate(entityIdSchema, input);
        return activeTransaction((tx) => tx.incident.findFirst({ where: { shopId, id } }));
      },
      occurrences: (identifier, input) => {
        const incidentId = validate(entityIdSchema, identifier);
        const { limit, offset } = validate(paginationSchema, input);
        return activeTransaction((tx) =>
          tx.incidentOccurrence.findMany({
            where: { shopId, incidentId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit,
            skip: offset,
          }),
        );
      },
    },
    analyses: {
      list: (input) => {
        const runId = validate(entityIdSchema, input);
        return activeTransaction((tx) =>
          tx.runAnalysis.findMany({
            where: { shopId, runId },
            orderBy: { attempt: 'asc' },
            take: 3,
            include: {
              findings: { orderBy: [{ stepPosition: 'asc' }, { type: 'asc' }], take: 88 },
            },
          }),
        );
      },
    },
    artifacts: {
      list: (input) => {
        const runId = validate(entityIdSchema, input);
        return activeTransaction((tx) =>
          tx.artifact.findMany({
            where: { shopId, runId },
            select: publicArtifactSelection,
            orderBy: [{ attempt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            take: 33,
          }),
        );
      },
      get: (input) => {
        const id = validate(entityIdSchema, input);
        return activeTransaction((tx) =>
          tx.artifact.findFirst({
            where: { shopId, id, status: 'READY', expiresAt: { gt: new Date() } },
          }),
        );
      },
    },
    shops: { get: () => activeTransaction((_tx, shop) => Promise.resolve(shop)) },
    monitors: {
      create: (input) => {
        const data = validate(createMonitorSchema, input);
        return activeTransaction((tx) => tx.monitor.create({ data: { ...data, shopId } }));
      },
      get: (input) => {
        const id = validate(entityIdSchema, input);
        return activeTransaction((tx) => tx.monitor.findFirst({ where: { shopId, id } }));
      },
      list: (input) => {
        const { limit, offset } = validate(paginationSchema, input);
        return activeTransaction((tx) =>
          tx.monitor.findMany({
            where: { shopId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit,
            skip: offset,
          }),
        );
      },
      update: (identifier, input) => {
        const id = validate(entityIdSchema, identifier);
        const { version, ...changes } = validate(updateMonitorSchema, input);
        return activeTransaction(async (tx) => {
          const current = await tx.monitor.findFirst({ where: { shopId, id } });
          if (!current) throw new DomainError('NOT_FOUND');
          if (current.version !== version) throw new DomainError('CONFLICT');
          const variantId =
            changes.productId && changes.productId !== current.productId
              ? (changes.variantId ?? null)
              : changes.variantId;
          const result = await tx.monitor.updateMany({
            where: { shopId, id, version },
            data: {
              ...(changes.name !== undefined ? { name: changes.name } : {}),
              ...(changes.productId !== undefined ? { productId: changes.productId } : {}),
              ...(changes.scenario !== undefined ? { scenario: changes.scenario } : {}),
              ...(changes.device !== undefined ? { device: changes.device } : {}),
              ...(changes.frequency !== undefined ? { frequency: changes.frequency } : {}),
              ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
              ...(variantId !== undefined ? { variantId } : {}),
              version: { increment: 1 },
            },
          });
          if (result.count !== 1) throw new DomainError('CONFLICT');
          return tx.monitor.findUniqueOrThrow({ where: { shopId_id: { shopId, id } } });
        });
      },
    },
    runs: {
      steps: (input) => {
        const runId = validate(entityIdSchema, input);
        return activeTransaction((tx) =>
          tx.runStep.findMany({
            where: { shopId, runId },
            orderBy: [{ attempt: 'asc' }, { position: 'asc' }],
            take: 21,
          }),
        );
      },
      create: (identifier) => {
        const monitorId = validate(entityIdSchema, identifier);
        return activeTransaction(async (tx) => {
          const monitor = await tx.monitor.findFirst({ where: { shopId, id: monitorId } });
          if (!monitor) throw new DomainError('NOT_FOUND');
          const snapshot = snapshotMonitor(monitor);
          return tx.testRun.create({
            data: { ...snapshot, shopId, monitorId, status: 'QUEUED', dispatchRequested: true },
            select: publicRunSelection,
          });
        });
      },
      get: (input) => {
        const id = validate(entityIdSchema, input);
        return activeTransaction((tx) =>
          tx.testRun.findFirst({ where: { shopId, id }, select: publicRunSelection }),
        );
      },
      list: (input) => {
        const { limit, offset, monitorId } = validate(listTestRunsSchema, input);
        return activeTransaction((tx) =>
          tx.testRun.findMany({
            select: publicRunSelection,
            where: { shopId, ...(monitorId ? { monitorId } : {}) },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit,
            skip: offset,
          }),
        );
      },
    },
  };
}
