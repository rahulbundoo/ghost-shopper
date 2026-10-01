import {
  dispatchPendingRuns,
  deliverPendingEmails,
  type EmailSender,
} from '@ghostshopper/application';
import {
  readRunnerConfig,
  readStorageConfig,
  readAiConfig,
  readAutomationConfig,
  readEmailConfig,
  readBillingConfig,
  readShopifyConfig,
  readHardeningConfig,
} from '@ghostshopper/config';
import { ResendEmailSender } from '@ghostshopper/notifications';
import { createShopifyApplication, TenantSessionStorage } from '@ghostshopper/shopify';
import { refreshBilling } from './billing.js';
import { OpenAiProvider } from '@ghostshopper/ai';
import { createAiAnalyzer, type RunAiAnalyzer } from './ai.js';
import {
  createDatabase,
  PrismaRunStore,
  PrismaArtifactRepository,
  PrismaAnalysisRepository,
  PrismaAiAnalysisRepository,
  PrismaAutomationStore,
  ShopRepository,
  PrismaMaintenance,
} from '@ghostshopper/database';
import { S3ArtifactStorage } from '@ghostshopper/storage';
import { createEvidenceRecorder } from './artifacts.js';
import { createLogger, createSentryReporter } from '@ghostshopper/observability';
import { randomUUID } from 'node:crypto';
import { deleteExpiredEvidence } from './maintenance.js';
import { BullRunPublisher, createRunWorker } from '@ghostshopper/queue';
import { createRunProcessor } from './processor.js';
import { PlaywrightJourneyEngine } from '@ghostshopper/browser';
import { createJourneyExecutor } from './journey.js';

export async function startRunner(environment: Record<string, string | undefined>) {
  const hardening = readHardeningConfig(environment);
  const config = readRunnerConfig(environment);
  const storageConfig = readStorageConfig(environment);
  const automationConfig = readAutomationConfig(environment);
  const billingPolicy = readBillingConfig(environment);
  const billingConfig = billingPolicy ? readShopifyConfig(environment) : null;
  const log = createLogger('runner', undefined, createSentryReporter(hardening.sentryDsn));
  const db = createDatabase(config.databaseUrl);
  await db.$connect();
  const storage = new S3ArtifactStorage(storageConfig);
  const store = new PrismaRunStore(db);
  const maintenance = new PrismaMaintenance(db);
  const heartbeatId = `runner-${randomUUID()}`;
  const automation = new PrismaAutomationStore(db, billingPolicy);
  const billingShopify = billingConfig
    ? createShopifyApplication(
        billingConfig,
        new TenantSessionStorage(db, hardening.sessionKey),
        new ShopRepository(db),
      )
    : null;
  let emailSender: EmailSender | undefined;
  try {
    const emailConfig = readEmailConfig(environment);
    if (emailConfig) emailSender = new ResendEmailSender(emailConfig);
    else log({ level: 'info', event: 'email.disabled' });
  } catch {
    log({ level: 'warn', event: 'email.disabled', code: 'EMAIL_CONFIGURATION_INVALID' });
  }
  const aiRepository = new PrismaAiAnalysisRepository(db);
  let aiAnalyzer: RunAiAnalyzer | undefined;
  try {
    const aiConfig = readAiConfig(environment);
    if (aiConfig) aiAnalyzer = createAiAnalyzer(new OpenAiProvider(aiConfig), aiRepository, log);
    else log({ level: 'info', event: 'ai.disabled' });
  } catch {
    // Bad optional AI configuration must not stop technical monitoring.
    log({ level: 'warn', event: 'ai.disabled', code: 'AI_CONFIGURATION_INVALID' });
  }
  const publisher = new BullRunPublisher(config, log);
  const worker = createRunWorker(
    config,
    config.concurrency,
    createRunProcessor(
      store,
      createJourneyExecutor(
        db,
        new PlaywrightJourneyEngine({
          channel: config.browserChannel,
          traceEnabled: hardening.traceEnabled,
          actionTimeoutMs: config.actionTimeoutMs,
        }),
      ),
      log,
      config.timeoutMs,
      createEvidenceRecorder(
        new PrismaArtifactRepository(db),
        storage,
        storageConfig.retentionDays,
        log,
      ),
      new PrismaAnalysisRepository(db),
      aiAnalyzer,
    ),
    log,
  );
  let stopping = false;
  let dispatching = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (stopping) return;
    dispatching = (async () => {
      if (automationConfig.schedulerEnabled) {
        try {
          await automation.schedule();
        } catch {
          log({ level: 'warn', event: 'scheduler.scan.failed', code: 'SCHEDULER_UNAVAILABLE' });
        }
      }
      await dispatchPendingRuns(store, publisher, log);
    })()
      .catch(() => {
        log({ level: 'error', event: 'dispatch.scan.failed', code: 'DISPATCH_UNAVAILABLE' });
      })
      .then(async () => {
        try {
          if (!stopping && (await publisher.healthy())) await maintenance.heartbeat(heartbeatId);
          await deleteExpiredEvidence(maintenance, storage, log, () => !stopping);
          await maintenance.prune();
        } catch {
          log({ level: 'warn', event: 'maintenance.failed', code: 'MAINTENANCE_FAILED' });
        }
        if (billingPolicy && billingConfig && billingShopify && !stopping) {
          try {
            await refreshBilling(
              db,
              billingShopify,
              billingPolicy,
              billingConfig.appUrl,
              log,
              () => !stopping,
            );
          } catch {
            log({ level: 'warn', event: 'billing.scan.failed', code: 'BILLING_UNAVAILABLE' });
          }
        }
        if (emailSender) {
          try {
            await deliverPendingEmails(automation, emailSender, log, () => !stopping);
          } catch {
            log({ level: 'warn', event: 'email.scan.failed', code: 'EMAIL_UNAVAILABLE' });
          }
        }
        try {
          await aiRepository.expire();
        } catch {
          log({ level: 'warn', event: 'ai.recovery.failed', code: 'AI_ANALYSIS_FAILED' });
        }
      })
      .finally(() => {
        if (!stopping) timer = setTimeout(tick, 5000);
      });
  };
  try {
    await Promise.race([
      worker.waitUntilReady(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('RUNNER_STARTUP_TIMEOUT')), 10_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
  } catch {
    stopping = true;
    if (timer) clearTimeout(timer);
    await worker.close(true);
    await publisher.close();
    await db.$disconnect();
    storage.close();
    throw new Error('RUNNER_STARTUP_FAILED');
  }
  tick();
  log({ level: 'info', event: 'runner.ready' });
  return {
    async close() {
      if (stopping) return;
      stopping = true;
      if (timer) clearTimeout(timer);
      log({ level: 'info', event: 'runner.stopping' });
      await dispatching;
      await worker.close();
      await publisher.close();
      await db.serviceHeartbeat.deleteMany({ where: { id: heartbeatId } });
      await db.$disconnect();
      storage.close();
      log({ level: 'info', event: 'runner.stopped' });
    },
  };
}
