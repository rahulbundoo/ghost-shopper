import { dispatchPendingRuns } from '@ghostshopper/application';
import { readRunnerConfig, readStorageConfig, readAiConfig } from '@ghostshopper/config';
import { OpenAiProvider } from '@ghostshopper/ai';
import { createAiAnalyzer, type RunAiAnalyzer } from './ai.js';
import {
  createDatabase,
  PrismaRunStore,
  PrismaArtifactRepository,
  PrismaAnalysisRepository,
  PrismaAiAnalysisRepository,
} from '@ghostshopper/database';
import { S3ArtifactStorage } from '@ghostshopper/storage';
import { createEvidenceRecorder } from './artifacts.js';
import { createLogger } from '@ghostshopper/observability';
import { BullRunPublisher, createRunWorker } from '@ghostshopper/queue';
import { createRunProcessor } from './processor.js';
import { PlaywrightJourneyEngine } from '@ghostshopper/browser';
import { createJourneyExecutor } from './journey.js';

export async function startRunner(environment: Record<string, string | undefined>) {
  const config = readRunnerConfig(environment);
  const storageConfig = readStorageConfig(environment);
  const log = createLogger('runner');
  const db = createDatabase(config.databaseUrl);
  await db.$connect();
  const storage = new S3ArtifactStorage(storageConfig);
  const store = new PrismaRunStore(db);
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
    dispatching = dispatchPendingRuns(store, publisher, log)
      .catch(() => {
        log({ level: 'error', event: 'dispatch.scan.failed', code: 'DISPATCH_UNAVAILABLE' });
      })
      .then(async () => {
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
      await db.$disconnect();
      storage.close();
      log({ level: 'info', event: 'runner.stopped' });
    },
  };
}
