import { index, route, type RouteConfig } from '@react-router/dev/routes';
export default [
  index('routes/home.tsx'),
  route('auth/login', 'routes/auth.login.tsx'),
  route('auth/*', 'routes/auth.tsx'),
  route('app', 'routes/app.tsx', [index('routes/app.index.tsx')]),
  // Resource routes authenticate independently; they do not rely on the UI layout loader.
  route('app/api/shop', 'routes/api.shop.ts'),
  route('app/api/monitors', 'routes/api.monitors.ts'),
  route('app/api/monitors/:monitorId', 'routes/api.monitor.ts'),
  route('app/api/runs', 'routes/api.runs.ts'),
  route('app/api/runs/:runId', 'routes/api.run.ts'),
  route('app/api/incidents', 'routes/api.incidents.ts'),
  route('app/api/incidents/:incidentId', 'routes/api.incident.ts'),
  route('app/api/artifacts/:artifactId/download', 'routes/api.artifact.ts'),
  route('webhooks/app/uninstalled', 'routes/webhooks.uninstalled.ts'),
  route('webhooks/app/scopes-update', 'routes/webhooks.scopes.ts'),
  route('webhooks/privacy', 'routes/webhooks.privacy.ts'),
  route('health', 'routes/health.ts'),
] satisfies RouteConfig;
