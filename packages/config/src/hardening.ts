export interface HardeningConfig {
  environment: 'local' | 'staging' | 'production';
  sessionKey: string | undefined;
  readinessToken: string | undefined;
  sentryDsn: string | undefined;
  traceEnabled: boolean;
}
export function readHardeningConfig(env: Record<string, string | undefined>): HardeningConfig {
  if (env['NODE_ENV'] === 'production' && !env['DEPLOYMENT_ENV'])
    throw new Error('DEPLOYMENT_ENV_REQUIRED');
  const environment = env['DEPLOYMENT_ENV'] ?? 'local';
  if (env['TRACE_ENABLED'] && !['true', 'false'].includes(env['TRACE_ENABLED']))
    throw new Error('TRACE_CONFIGURATION_INVALID');
  if (!['local', 'staging', 'production'].includes(environment))
    throw new Error('HARDENING_CONFIGURATION_INVALID');
  const sessionKey = env['SESSION_ENCRYPTION_KEY'];
  const readinessToken = env['READINESS_TOKEN'];
  if (sessionKey && !/^[a-f0-9]{64}$/i.test(sessionKey)) throw new Error('SESSION_KEY_INVALID');
  if (readinessToken && !/^[a-zA-Z0-9_-]{32,128}$/.test(readinessToken))
    throw new Error('READINESS_TOKEN_INVALID');
  if (environment !== 'local') {
    if (!sessionKey || !readinessToken) throw new Error('PRODUCTION_SECRETS_REQUIRED');
    for (const name of ['SHOPIFY_API_SECRET', 'S3_SECRET_ACCESS_KEY']) {
      const value = env[name];
      if (!value || value.length < 24 || /local_only|example|changeme|test-api/i.test(value))
        throw new Error('PRODUCTION_SECRETS_REQUIRED');
    }
    const db = new URL(env['DATABASE_URL'] ?? '');
    const redis = new URL(env['REDIS_URL'] ?? '');
    const storage = new URL(env['S3_ENDPOINT'] ?? '');
    if (
      !['require', 'verify-ca', 'verify-full'].includes(db.searchParams.get('sslmode') ?? '') ||
      redis.protocol !== 'rediss:' ||
      !redis.password ||
      storage.protocol !== 'https:'
    )
      throw new Error('PRODUCTION_TLS_REQUIRED');
    if (env['BILLING_ENABLED'] !== 'true') throw new Error('PRODUCTION_BILLING_LIMITS_REQUIRED');
    if (env['ARTIFACT_BUCKET_LIFECYCLE_CONFIRMED'] !== 'true')
      throw new Error('STORAGE_LIFECYCLE_REQUIRED');
    if (env['RUNNER_ISOLATION_CONFIRMED'] !== 'true' || env['BACKUP_RESTORE_VERIFIED'] !== 'true')
      throw new Error('PRODUCTION_ACCEPTANCE_REQUIRED');
    if (env['INGRESS_LIMITS_CONFIRMED'] !== 'true') throw new Error('INGRESS_LIMITS_REQUIRED');
  }
  return {
    environment: environment as HardeningConfig['environment'],
    sessionKey,
    readinessToken,
    sentryDsn: env['SENTRY_DSN'] || undefined,
    traceEnabled: env['TRACE_ENABLED'] === 'true',
  };
}
