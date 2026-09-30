import type { TestRun } from '@ghostshopper/domain';
import { readQueueConfig } from '@ghostshopper/config';
import { PrismaRunStore } from '@ghostshopper/database';
import { BullRunPublisher } from '@ghostshopper/queue';
import { createLogger } from '@ghostshopper/observability';
import { getRuntime } from './shopify.server.js';

const log = createLogger('web');
let publisher: BullRunPublisher | undefined;
// The run + durable intent are already committed. Redis failure must not cause
// the client to unknowingly create a second run by retrying a failed HTTP request.
export async function enqueueCreatedRun(run: TestRun): Promise<'ENQUEUED' | 'DISPATCH_PENDING'> {
  const job = { version: 1 as const, runId: run.id, shopId: run.shopId };
  try {
    publisher ??= new BullRunPublisher(readQueueConfig(process.env), log);
    await publisher.publish(job);
    await new PrismaRunStore(getRuntime().db).dispatched(job);
    log({ level: 'info', event: 'run.enqueued', runId: run.id, shopId: run.shopId, jobId: run.id });
    return 'ENQUEUED';
  } catch {
    log({
      level: 'warn',
      event: 'run.dispatch.deferred',
      runId: run.id,
      shopId: run.shopId,
      code: 'QUEUE_UNAVAILABLE',
    });
    return 'DISPATCH_PENDING';
  }
}
