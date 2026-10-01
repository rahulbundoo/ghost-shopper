import {
  readHardeningConfig,
  readShopifyConfig,
  readRunnerConfig,
  readStorageConfig,
  readBillingConfig,
} from '../packages/config/dist/index.js';
import { createSentryReporter } from '../packages/observability/dist/index.js';
try {
  const config = readHardeningConfig(process.env);
  createSentryReporter(config.sentryDsn); // Validate only; sends no telemetry.
  if (config.environment !== 'local') {
    readShopifyConfig(process.env);
    readRunnerConfig(process.env);
    readStorageConfig(process.env);
    readBillingConfig(process.env);
  }
  console.info(JSON.stringify({ event: 'configuration.valid', environment: config.environment }));
} catch {
  console.error(
    JSON.stringify({ event: 'configuration.invalid', code: 'DEPLOYMENT_CONFIGURATION_INVALID' }),
  );
  process.exitCode = 1;
}
