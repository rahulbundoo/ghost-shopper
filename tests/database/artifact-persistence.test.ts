import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  PrismaArtifactRepository,
  PrismaRunStore,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService, type RunClaim } from '../../packages/application/src/index.js';
import type { ArtifactReservation } from '../../packages/domain/src/index.js';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must select a dedicated migrated database.');
const db = createDatabase(url);
const shopId = `evidence-${randomUUID()}.myshopify.com`;
const otherId = `evidence-${randomUUID()}.myshopify.com`;
const lifecycle = new ShopRepository(db);
const service = new MonitoringService(createTenantRepositories(db, shopId));
const other = new MonitoringService(createTenantRepositories(db, otherId));
const runs = new PrismaRunStore(db);
const repository = new PrismaArtifactRepository(db);
let claim: RunClaim;
beforeAll(async () => {
  await lifecycle.markInstalled(shopId, '');
  await lifecycle.markInstalled(otherId, '');
  const monitor = await service.createMonitor({
    name: 'Evidence',
    productId: 'gid://shopify/Product/1',
    device: 'DESKTOP',
  });
  const run = await service.createTestRun({ monitorId: monitor.id });
  const result = await runs.claim({ version: 1, shopId, runId: run.id }, 300000);
  if (result.kind !== 'claimed') throw new Error('Expected claim');
  claim = result.claim;
  await runs.recordStep(claim, {
    action: 'OPEN_HOME',
    position: 0,
    status: 'PASSED',
    startedAt: new Date(0),
    finishedAt: new Date(1),
    durationMs: 1,
    currentUrl: 'https://shop.example/',
    errorCode: null,
    errorMessage: null,
  });
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: { in: [shopId, otherId] } } });
  } finally {
    await db.$disconnect();
  }
});
function reservation(): ArtifactReservation {
  const id = randomUUID();
  const tenant = createHash('sha256').update(shopId).digest('hex');
  return {
    id,
    type: 'SCREENSHOT',
    stepPosition: 0,
    storageKey: `evidence/${tenant}/${claim.run.id}/1/${id}.png`,
    sizeBytes: 8,
    sha256: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 86400000),
  };
}
describe('artifact persistence and authorization', () => {
  it('hides pending/failed artifacts from downloads and never exposes keys in lists', async () => {
    const data = reservation();
    expect(await repository.reserve(claim, data)).toBe(true);
    expect(await service.getArtifact(data.id)).toBeNull();
    expect(await repository.finish(claim, data.id, true)).toBe(true);
    const artifact = await service.getArtifact(data.id);
    expect(artifact).toMatchObject({
      status: 'READY',
      stepPosition: 0,
      storageKey: data.storageKey,
    });
    expect(artifact?.stepId).not.toBeNull();
    expect(await other.getArtifact(data.id)).toBeNull();
    expect(await other.listArtifacts(claim.run.id)).toEqual([]);
    expect((await service.listArtifacts(claim.run.id))[0]).not.toHaveProperty('storageKey');
    expect(await repository.finish(claim, data.id, false)).toBe(false);
  });
  it('enforces stale leases, failure state, expiry and cross-tenant foreign keys', async () => {
    const data = reservation();
    expect(await repository.reserve({ ...claim, token: randomUUID() }, data)).toBe(false);
    await repository.reserve(claim, data);
    await repository.finish(claim, data.id, false);
    expect(await service.getArtifact(data.id)).toBeNull();
    const expired = reservation();
    await repository.reserve(claim, expired);
    await repository.finish(claim, expired.id, true);
    await db.artifact.update({
      where: { id: expired.id },
      data: {
        createdAt: new Date(Date.now() - 172800000),
        expiresAt: new Date(Date.now() - 86400000),
      },
    });
    expect(await service.getArtifact(expired.id)).toBeNull();
    await expect(
      db.artifact.update({ where: { id: data.id }, data: { shopId: otherId } }),
    ).rejects.toThrow();
    await lifecycle.uninstall(shopId);
    expect(await repository.reserve(claim, reservation())).toBe(false);
    await expect(service.getArtifact(data.id)).rejects.toThrow('SHOP_INACTIVE');
  });
});
