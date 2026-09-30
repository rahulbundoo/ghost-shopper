import { createLogger } from '@ghostshopper/observability';
import { startRunner } from './service.js';

const log = createLogger('runner');
try {
  // CI image/module smoke check deliberately does not connect to infrastructure.
  if (process.argv.includes('--check')) log({ level: 'info', event: 'runner.modules.ready' });
  else {
    const runner = await startRunner(process.env);
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      // Force termination if dependencies stop responding; DB leases permit recovery.
      const deadline = setTimeout(() => process.exit(1), 375_000);
      deadline.unref();
      void runner
        .close()
        .then(() => {
          clearTimeout(deadline);
          process.exitCode = 0;
        })
        .catch(() => {
          log({ level: 'error', event: 'runner.shutdown.failed', code: 'SHUTDOWN_FAILED' });
          process.exit(1);
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
} catch {
  log({ level: 'error', event: 'runner.startup.failed', code: 'RUNNER_STARTUP_FAILED' });
  process.exit(1);
}
