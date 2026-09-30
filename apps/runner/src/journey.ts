import { type PlaywrightJourneyEngine, BrowserExecutionError } from '@ghostshopper/browser';
import type { PrismaClient } from '@ghostshopper/database';
import { ExecutionFailure, type JourneyExecutor } from './processor.js';

export function createJourneyExecutor(
  db: PrismaClient,
  engine: PlaywrightJourneyEngine,
): JourneyExecutor {
  return {
    async execute(run, signal, recordStep, recordEvidence) {
      const shop = await db.shop.findFirst({
        where: { id: run.shopId, installedAt: { not: null }, uninstalledAt: null },
        select: { storefrontUrl: true },
      });
      if (!shop) throw new ExecutionFailure('SHOP_INACTIVE');
      try {
        return await engine.execute(
          run,
          shop.storefrontUrl ?? `https://${run.shopId}`,
          signal,
          recordStep,
          recordEvidence,
        );
      } catch (error) {
        // Browser failures must not automatically replay storefront side effects.
        throw new ExecutionFailure(
          error instanceof BrowserExecutionError && error.code === 'BROWSER_UNAVAILABLE'
            ? 'BROWSER_UNAVAILABLE'
            : 'BROWSER_EXECUTION_FAILED',
          false,
          { cause: error },
        );
      }
    },
  };
}
