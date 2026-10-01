import { Queue, Worker, UnrecoverableError, type ConnectionOptions } from 'bullmq';
import {
  RUN_MONITOR,
  runMonitorJobSchema,
  validate,
  type RunMonitorJob,
} from '@ghostshopper/contracts';
import type { RunLogger, RunPublisher } from '@ghostshopper/application';

export const RUN_QUEUE = 'monitor-runs';
export interface QueueConfig {
  redisUrl: string;
  prefix: string;
}
export function redisConnection(redisUrl: string, worker = false): ConnectionOptions {
  const url = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('INVALID_REDIS_URL');
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    connectTimeout: 3000,
    ...(worker ? {} : { enableOfflineQueue: false, commandTimeout: 3000 }),
  };
}
export class BullRunPublisher implements RunPublisher {
  private readonly queue: Queue<RunMonitorJob>;
  constructor(config: QueueConfig, log: RunLogger) {
    this.queue = new Queue<RunMonitorJob>(RUN_QUEUE, {
      connection: redisConnection(config.redisUrl),
      prefix: config.prefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800, count: 1000 },
      },
    });
    this.queue.on('error', () =>
      log({ level: 'error', event: 'queue.connection.error', code: 'REDIS_UNAVAILABLE' }),
    );
  }
  async publish(input: RunMonitorJob): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.publishInternal(input),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('QUEUE_PUBLISH_TIMEOUT')), 3500);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async publishInternal(input: RunMonitorJob): Promise<void> {
    const job = validate(runMonitorJobSchema, input);
    const existing = await this.queue.getJob(job.runId);
    if (existing) {
      const previous = validate(runMonitorJobSchema, existing.data);
      if (previous.shopId !== job.shopId) throw new Error('JOB_TENANT_MISMATCH');
      const state = await existing.getState();
      // Reconciliation calls this only for DB-pending work. DB claims are authoritative.
      if (state === 'failed' || state === 'completed') await existing.retry(state);
      return;
    }
    await this.queue.add(RUN_MONITOR, job, { jobId: job.runId });
  }
  async close(): Promise<void> {
    await this.queue.close();
  }
  async healthy(): Promise<boolean> {
    try {
      await this.queue.getJobCounts('waiting');
      return true;
    } catch {
      return false;
    }
  }
}

export function createRunWorker(
  config: QueueConfig,
  concurrency: number,
  processRun: (job: RunMonitorJob) => Promise<void>,
  log: RunLogger,
) {
  const worker = new Worker<RunMonitorJob>(
    RUN_QUEUE,
    async (job) => {
      const parsed = runMonitorJobSchema.safeParse(job.data);
      if (job.name !== RUN_MONITOR || !parsed.success || job.id !== parsed.data.runId) {
        log({ level: 'warn', event: 'job.rejected', code: 'INVALID_JOB' });
        throw new UnrecoverableError('INVALID_JOB');
      }
      try {
        await processRun(parsed.data);
      } catch {
        throw new Error('RUN_PROCESSING_FAILED');
      }
    },
    {
      connection: redisConnection(config.redisUrl, true),
      prefix: config.prefix,
      concurrency,
      lockDuration: 30_000,
      maxStalledCount: 2,
    },
  );
  worker.on('error', () =>
    log({ level: 'error', event: 'worker.connection.error', code: 'WORKER_ERROR' }),
  );
  worker.on('failed', (job) =>
    log({
      level: 'warn',
      event: 'job.failed',
      ...(job?.id ? { jobId: job.id } : {}),
      code: 'JOB_ATTEMPT_FAILED',
    }),
  );
  worker.on('stalled', (jobId) =>
    log({ level: 'warn', event: 'job.stalled', jobId, code: 'JOB_STALLED' }),
  );
  return worker;
}
