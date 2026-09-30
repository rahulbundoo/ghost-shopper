// Structured logging, correlation and telemetry adapters.
// Phase 3 structured logging; telemetry exporters remain production hardening.
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
}
export function createLogger(
  service: 'web' | 'runner',
  sink: (line: string) => void = (line) => console.info(line),
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
      }),
    );
  };
}
