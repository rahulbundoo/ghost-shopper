import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nextScheduledTime,
  significantIncident,
  EMAIL_RETRY_WINDOW_MS,
} from '../../packages/domain/src/index.js';
import { deliverPendingEmails, type EmailClaim } from '../../packages/application/src/index.js';
import { PrismaAutomationStore } from '../../packages/database/src/automation.js';
import type { PrismaClient } from '../../packages/database/src/index.js';
import { ResendEmailSender } from '../../packages/notifications/src/index.js';
import { readAutomationConfig, readEmailConfig } from '../../packages/config/src/index.js';
import { notificationSettingsSchema } from '../../packages/contracts/src/index.js';

const now = new Date('2026-09-30T12:00:00Z');
const claim: EmailClaim = {
  id: 'email-id',
  token: 'token',
  shopId: 'fixture.myshopify.com',
  runId: 'run-id',
  recipient: 'owner@example.com',
  kind: 'FAILURE',
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const monitor = {
    id: 'monitor',
    shopId: claim.shopId,
    enabled: true,
    productId: 'gid://shopify/Product/1',
    variantId: null,
    device: 'DESKTOP',
    scenario: 'PURCHASE_JOURNEY',
    frequency: 'HOURLY',
    version: 1,
  };
  const email = {
    ...claim,
    monitorId: monitor.id,
    configKey: 'key',
    status: 'PENDING',
    channelVersion: 1,
    attemptCount: 0,
    firstAttemptAt: null,
    createdAt: new Date(now.getTime() - 1000),
    shop: { installedAt: now, uninstalledAt: null },
    run: { ...monitor, monitor },
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: claim.id, shopId: claim.shopId }]),
    monitor: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(monitor),
      update: vi.fn().mockResolvedValue({}),
    },
    testRun: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    incident: { count: vi.fn().mockResolvedValue(1) },
    notificationChannel: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        email: claim.recipient,
        enabled: true,
        recoveryEnabled: true,
        version: 1,
        nextSendAt: now,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    emailDelivery: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(email),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({ status: 'SENT' }),
    },
  };
  const db = {
    $transaction: vi.fn((op: (client: typeof tx) => Promise<unknown>) => op(tx)),
    emailDelivery: tx.emailDelivery,
  };
  return { tx, email, monitor, store: new PrismaAutomationStore(db as unknown as PrismaClient) };
}
describe('schedule and notification policy', () => {
  it.each([
    ['HOURLY', 3600000],
    ['EVERY_SIX_HOURS', 21600000],
    ['DAILY', 86400000],
  ] as const)('advances %s from now without replaying missed ticks', (frequency, milliseconds) => {
    expect(nextScheduledTime(now, frequency).getTime()).toBe(now.getTime() + milliseconds);
  });
  it('alerts on significant technical incidents only', () => {
    expect(
      ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) =>
        significantIncident(value as Parameters<typeof significantIncident>[0]),
      ),
    ).toEqual([false, false, false, true, true]);
  });
  it('requires explicit deployment opt-in and valid email configuration', () => {
    expect(readAutomationConfig({}).schedulerEnabled).toBe(false);
    expect(readAutomationConfig({ SCHEDULER_ENABLED: 'true' }).schedulerEnabled).toBe(true);
    expect(() => readAutomationConfig({ SCHEDULER_ENABLED: 'yes' })).toThrow();
    expect(readEmailConfig({ RESEND_API_KEY: 'secret' })).toBeNull();
    expect(() => readEmailConfig({ EMAIL_ENABLED: 'true' })).toThrow();
    expect(
      readEmailConfig({
        EMAIL_ENABLED: 'true',
        RESEND_API_KEY: 'key',
        EMAIL_FROM: 'alerts@example.com',
        SHOPIFY_APP_URL: 'https://app.example.com',
      }),
    ).toMatchObject({ from: 'alerts@example.com' });
    expect(
      notificationSettingsSchema.safeParse({
        email: 'owner@example.com\nBcc:other@example.com',
        enabled: true,
        recoveryEnabled: true,
        version: 0,
      }).success,
    ).toBe(false);
    expect(
      notificationSettingsSchema.safeParse({
        email: 'owner@example.com',
        enabled: true,
        recoveryEnabled: true,
        version: 0,
        shopId: 'forged',
      }).success,
    ).toBe(false);
  });
});
describe('durable automation adapter', () => {
  it('atomically creates a queued snapshot and advances the locked schedule', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue([{ id: f.monitor.id, shopId: claim.shopId }]);
    expect(await f.store.schedule()).toBe(1);
    expect(f.tx.testRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shopId: claim.shopId,
        monitorId: f.monitor.id,
        monitorVersion: 1,
        dispatchRequested: true,
      }) as unknown,
    });
    expect(f.tx.monitor.update).toHaveBeenCalledWith({
      where: { shopId_id: { shopId: claim.shopId, id: f.monitor.id } },
      data: { nextRunAt: new Date(now.getTime() + 3600000) },
    });
    expect(String(f.tx.$queryRaw.mock.calls[0]?.[0])).toContain('FOR UPDATE OF m SKIP LOCKED');
  });
  it('defers a due monitor with an active run instead of creating overlapping work', async () => {
    const f = fixture();
    f.tx.testRun.findFirst.mockResolvedValue({ id: 'active' });
    expect(await f.store.schedule()).toBe(0);
    expect(f.tx.testRun.create).not.toHaveBeenCalled();
    expect(f.tx.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nextRunAt: new Date(now.getTime() + 60000) } }),
    );
  });
  it('reserves a bounded email lease and persistent per-shop cooldown', async () => {
    const f = fixture();
    expect(await f.store.claimEmail()).toMatchObject({
      id: claim.id,
      recipient: claim.recipient,
      kind: 'FAILURE',
    });
    expect(f.tx.notificationChannel.update).toHaveBeenCalledWith({
      where: { shopId: claim.shopId },
      data: { nextSendAt: new Date(now.getTime() + 900000) },
    });
    expect(f.tx.emailDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENDING',
          attemptCount: { increment: 1 },
          firstAttemptAt: now,
        }) as unknown,
      }),
    );
  });
  it.each([
    'disabled',
    'edited',
    'uninstalled',
    'monitorDisabled',
    'configChanged',
    'obsolete',
    'expired',
    'exhausted',
  ] as const)('does not send when %s', async (mode) => {
    const f = fixture();
    if (mode === 'disabled')
      f.tx.notificationChannel.findUniqueOrThrow.mockResolvedValue({ enabled: false });
    if (mode === 'edited')
      f.tx.notificationChannel.findUniqueOrThrow.mockResolvedValue({ enabled: true, version: 2 });
    if (mode === 'uninstalled')
      f.tx.emailDelivery.findUniqueOrThrow.mockResolvedValue({
        ...f.email,
        shop: { installedAt: now, uninstalledAt: now },
      });
    if (mode === 'monitorDisabled' || mode === 'configChanged')
      f.tx.emailDelivery.findUniqueOrThrow.mockResolvedValue({
        ...f.email,
        run: {
          ...f.email.run,
          monitor: { ...f.monitor, enabled: mode !== 'monitorDisabled', productId: 'other' },
        },
      });
    if (mode === 'obsolete') f.tx.incident.count.mockResolvedValue(0);
    if (mode === 'expired')
      f.tx.emailDelivery.findUniqueOrThrow.mockResolvedValue({
        ...f.email,
        firstAttemptAt: new Date(now.getTime() - EMAIL_RETRY_WINDOW_MS),
      });
    if (mode === 'exhausted')
      f.tx.emailDelivery.findUniqueOrThrow.mockResolvedValue({ ...f.email, attemptCount: 6 });
    expect(await f.store.claimEmail()).toBeNull();
    expect(f.tx.notificationChannel.update).not.toHaveBeenCalled();
    expect(f.tx.emailDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ['expired', 'exhausted'].includes(mode) ? 'FAILED' : 'CANCELLED',
          leaseToken: null,
        }) as unknown,
      }),
    );
  });
  it('does not send recovery unless a matching failure was accepted', async () => {
    const f = fixture();
    f.tx.emailDelivery.findUniqueOrThrow.mockResolvedValue({ ...f.email, kind: 'RECOVERY' });
    f.tx.incident.count.mockResolvedValue(0);
    f.tx.emailDelivery.findFirst.mockResolvedValue({ status: 'FAILED' });
    expect(await f.store.claimEmail()).toBeNull();
    f.tx.emailDelivery.findFirst.mockResolvedValue({ status: 'SENT' });
    expect(await f.store.claimEmail()).toMatchObject({ kind: 'RECOVERY' });
  });
  it('waits for cooldown and fences stale completion writes', async () => {
    const f = fixture();
    f.tx.notificationChannel.findUniqueOrThrow.mockResolvedValue({
      email: claim.recipient,
      enabled: true,
      version: 1,
      nextSendAt: new Date(now.getTime() + 10000),
    });
    expect(await f.store.claimEmail()).toBeNull();
    expect(f.tx.notificationChannel.update).not.toHaveBeenCalled();
    await f.store.finishEmail(claim, 'RETRY');
    expect(f.tx.emailDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: claim.id, shopId: claim.shopId, status: 'SENDING', leaseToken: claim.token },
        data: expect.objectContaining({ status: 'PENDING', leaseToken: null }) as unknown,
      }),
    );
  });
});
describe('email delivery without live mail', () => {
  const config = {
    apiKey: 'fixture-key',
    from: 'alerts@example.com',
    appUrl: 'https://app.example.com',
  };
  it.each([
    [200, 'ACCEPTED'],
    [429, 'RETRY'],
    [503, 'RETRY'],
    [409, 'RETRY'],
    [401, 'REJECTED'],
    [422, 'REJECTED'],
  ] as const)('handles HTTP %s without leaking provider bodies', async (status, result) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private-provider-response', { status }));
    expect(await new ResendEmailSender(config, request).send(claim)).toBe(result);
    expect(request).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({ 'Idempotency-Key': 'ghostshopper/email-id' }) as unknown,
      }),
    );
    const requestBody = request.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected JSON request');
    const body = JSON.parse(requestBody) as {
      text: string;
      to: string[];
    };
    expect(body.to).toEqual([claim.recipient]);
    expect(body.text).toContain('/app/runs/run-id');
    expect(body.text).not.toContain('private-provider-response');
  });
  it('reuses idempotency key and immutable payload after ambiguous network failure', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('secret timeout'))
      .mockResolvedValueOnce(new Response('{}'));
    const sender = new ResendEmailSender(config, request);
    expect(await sender.send(claim)).toBe('RETRY');
    expect(await sender.send(claim)).toBe('ACCEPTED');
    expect(request.mock.calls[0]?.[1]?.body).toBe(request.mock.calls[1]?.[1]?.body);
    expect(request.mock.calls[0]?.[1]?.headers).toEqual(request.mock.calls[1]?.[1]?.headers);
  });
  it('stops a maintenance batch on transient failure and never logs recipient', async () => {
    const store = {
      schedule: vi.fn(),
      claimEmail: vi.fn().mockResolvedValue(claim),
      finishEmail: vi.fn(),
    };
    const log = vi.fn();
    await deliverPendingEmails(
      store,
      { send: vi.fn().mockRejectedValue(new Error('provider')) },
      log,
    );
    expect(store.claimEmail).toHaveBeenCalledOnce();
    expect(store.finishEmail).toHaveBeenCalledWith(claim, 'RETRY');
    expect(JSON.stringify(log.mock.calls)).not.toContain(claim.recipient);
    store.claimEmail.mockClear();
    await deliverPendingEmails(store, { send: vi.fn() }, log, () => false);
    expect(store.claimEmail).not.toHaveBeenCalled();
  });
});
