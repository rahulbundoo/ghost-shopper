import type { createSentryReporter } from './sentry.js';
export { createSentryReporter } from './sentry.js';
export interface LogEvent {
  level: 'info' | 'warn' | 'error';
  event: string;
  runId?: string;
  shopId?: string;
  monitorId?: string;
  jobId?: string;
  attempt?: number;
  durationMs?: number;
  code?: string;
  requestId?: string;
}
export function createLogger(
  service: 'web' | 'runner',
  sink: (line: string) => void = (line) => console.info(line),
  report?: ReturnType<typeof createSentryReporter>,
) {
  return (event: LogEvent): void => {
    // Explicit allowlist: no free-form exception, token, URL or request payload logging.
    sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        service,
        level: event.level,
        event: event.event,
        runId: event.runId,
        shopId: event.shopId,
        monitorId: event.monitorId,
        jobId: event.jobId,
        attempt: event.attempt,
        durationMs: event.durationMs,
        code: event.code,
        requestId: event.requestId,
      }),
    );
    if (report && event.level !== 'info')
      void report({ service, event: event.event, ...(event.code ? { code: event.code } : {}) });
  };
}
