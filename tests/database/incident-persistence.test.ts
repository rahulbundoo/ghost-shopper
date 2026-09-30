import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  createTenantRepositories,
  PrismaAnalysisRepository,
  PrismaRunStore,
  ShopRepository,
} from '../../packages/database/src/index.js';
import { MonitoringService } from '../../packages/application/src/index.js';
import { JOURNEY_ACTIONS, type ActionResult } from '../../packages/domain/src/index.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must select a dedicated migrated database.');
const db = createDatabase(url);
const shopId = `incidents-${randomUUID()}.myshopify.com`;
const otherId = `incidents-${randomUUID()}.myshopify.com`;
const shops = new ShopRepository(db);
const service = new MonitoringService(createTenantRepositories(db, shopId));
const other = new MonitoringService(createTenantRepositories(db, otherId));
const runs = new PrismaRunStore(db);
const analyses = new PrismaAnalysisRepository(db);
beforeAll(async () => {
  await shops.markInstalled(shopId, '');
  await shops.markInstalled(otherId, '');
});
afterAll(async () => {
  try {
    await db.shop.deleteMany({ where: { id: { in: [shopId, otherId] } } });
  } finally {
    await db.$disconnect();
  }
});
const monitor = () =>
  service.createMonitor({
    name: 'Incident test',
    device: 'DESKTOP',
    productId: 'gid://shopify/Product/1',
  });
async function prepare(
  monitorId: string,
  kind: 'failed' | 'clean' | 'incomplete' | 'warning',
  order: number,
) {
  const run = await service.createTestRun({ monitorId });
  await db.testRun.update({
    where: { id: run.id },
    data: { createdAt: new Date(1700000000000 + order * 1000) },
  });
  const claimed = await runs.claim({ version: 1, shopId, runId: run.id }, 300000);
  if (claimed.kind !== 'claimed') throw new Error('Expected claim');
  const claim = claimed.claim;
  const steps: ActionResult[] = JOURNEY_ACTIONS.map((action, position) => {
    const failed = kind === 'failed' && position >= 4;
    return {
      action,
      position,
      status: failed ? (position === 4 ? 'FAILED' : 'SKIPPED') : 'PASSED',
      startedAt: new Date(0),
      finishedAt: new Date(1),
      durationMs: 1,
      currentUrl: null,
      errorCode: failed ? (position === 4 ? 'ADD_TO_CART_FAILURE' : 'PREVIOUS_STEP_FAILED') : null,
      errorMessage: failed ? 'safe fixture error' : null,
    };
  });
  for (const step of steps) await runs.recordStep(claim, step);
  await runs.advance(claim, 'RUNNING', 'COLLECTING');
  await runs.advance(claim, 'COLLECTING', 'ANALYZING');
  const result = await analyses.save(claim, {
    steps,
    diagnostics:
      kind === 'warning' ? [{ kind: 'JS_ERROR', stepPosition: 0, resourceType: null }] : [],
    diagnosticsComplete: kind !== 'incomplete',
    journeyOutcome: kind === 'failed' ? 'FAILED' : 'PASSED',
  });
  if (!result) throw new Error('Expected analysis');
  return { claim, complete: () => runs.advance(claim, 'ANALYZING', 'COMPLETED', result.outcome) };
}
describe('real incident persistence', () => {
  it('deduplicates concurrent repeated failures, counts once per run, resolves and reopens', async () => {
    const m = await monitor();
    const first = await prepare(m.id, 'failed', 1);
    const second = await prepare(m.id, 'failed', 2);
    expect(await Promise.all([first.complete(), second.complete()])).toEqual([true, true]);
    expect(await first.complete()).toBe(false);
    const third = await prepare(m.id, 'failed', 3);
    await third.complete();
    let rows = await service.listIncidents({ monitorId: m.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'OPEN', occurrenceCount: 3 });
    const id = rows[0]!.id;
    expect(await service.listIncidentOccurrences(id)).toHaveLength(3);
    const clean = await prepare(m.id, 'clean', 4);
    await clean.complete();
    expect(await service.getIncident(id)).toMatchObject({
      status: 'RESOLVED',
      occurrenceCount: 3,
      resolvedRunId: clean.claim.run.id,
    });
    const recur = await prepare(m.id, 'failed', 5);
    await recur.complete();
    rows = await service.listIncidents({ monitorId: m.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, status: 'OPEN', occurrenceCount: 4, resolvedAt: null });
  });
  it('counts late failures without undoing newer recovery and ignores older passes', async () => {
    const m = await monitor();
    const late = await prepare(m.id, 'failed', 1);
    const clean = await prepare(m.id, 'clean', 3);
    await clean.complete();
    await late.complete();
    const incident = (await service.listIncidents({ monitorId: m.id }))[0]!;
    expect(incident).toMatchObject({
      status: 'RESOLVED',
      occurrenceCount: 1,
      resolvedRunId: clean.claim.run.id,
    });
    const newest = await prepare(m.id, 'failed', 5);
    await newest.complete();
    const olderPass = await prepare(m.id, 'clean', 4);
    await olderPass.complete();
    expect(await service.getIncident(incident.id)).toMatchObject({
      status: 'OPEN',
      occurrenceCount: 2,
      lastSeenRunId: newest.claim.run.id,
    });
    const earlierFailure = await prepare(m.id, 'failed', 2);
    await earlierFailure.complete();
    expect(await service.getIncident(incident.id)).toMatchObject({
      status: 'OPEN',
      occurrenceCount: 3,
      lastSeenRunId: newest.claim.run.id,
    });
  });
  it('does not resolve on incomplete/warning results or a different configuration', async () => {
    const m = await monitor();
    const failed = await prepare(m.id, 'failed', 1);
    await failed.complete();
    const id = (await service.listIncidents({ monitorId: m.id }))[0]!.id;
    await (await prepare(m.id, 'incomplete', 2)).complete();
    await (await prepare(m.id, 'warning', 3)).complete();
    expect(await service.getIncident(id)).toMatchObject({ status: 'OPEN', occurrenceCount: 1 });
    await service.updateMonitor(m.id, { version: 1, device: 'MOBILE' });
    await (await prepare(m.id, 'clean', 4)).complete();
    expect(await service.getIncident(id)).toMatchObject({ status: 'OPEN' });
  });
  it('rolls back terminal state on reconciliation failure and rejects stale completions', async () => {
    const m = await monitor();
    const f = await prepare(m.id, 'failed', 1);
    expect(
      await runs.advance({ ...f.claim, token: randomUUID() }, 'ANALYZING', 'COMPLETED', 'FAILED'),
    ).toBe(false);
    expect(await service.listIncidents({ monitorId: m.id })).toEqual([]);
    await expect(runs.advance(f.claim, 'ANALYZING', 'COMPLETED', 'PASSED')).rejects.toThrow(
      'INCIDENT_OUTCOME_MISMATCH',
    );
    expect(await service.getTestRun(f.claim.run.id)).toMatchObject({ status: 'ANALYZING' });
    expect(await service.listIncidents({ monitorId: m.id })).toEqual([]);
    expect(await f.complete()).toBe(true);
  });
  it('enforces tenant scope, SQL links, inactive access and redaction cascades', async () => {
    const m = await monitor();
    const f = await prepare(m.id, 'failed', 1);
    await f.complete();
    const incident = (await service.listIncidents({ monitorId: m.id }))[0]!;
    const occurrence = (await service.listIncidentOccurrences(incident.id))[0]!;
    expect(await other.getIncident(incident.id)).toBeNull();
    expect(await other.listIncidentOccurrences(incident.id)).toEqual([]);
    expect(await other.listIncidents({ monitorId: m.id })).toEqual([]);
    await expect(
      db.incident.update({ where: { id: incident.id }, data: { shopId: otherId } }),
    ).rejects.toThrow();
    await expect(
      db.incidentOccurrence.update({ where: { id: occurrence.id }, data: { shopId: otherId } }),
    ).rejects.toThrow();
    await expect(
      db.incident.update({ where: { id: incident.id }, data: { occurrenceCount: -1 } }),
    ).rejects.toThrow();
    const pending = await prepare(m.id, 'clean', 2);
    await shops.uninstall(shopId);
    expect(await pending.complete()).toBe(false);
    await expect(service.getIncident(incident.id)).rejects.toThrow('SHOP_INACTIVE');
    await shops.redactUninstalledShop(shopId);
    expect(await db.incident.count({ where: { shopId } })).toBe(0);
    expect(await db.incidentOccurrence.count({ where: { shopId } })).toBe(0);
  });
});
