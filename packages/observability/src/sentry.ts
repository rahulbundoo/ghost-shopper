import { randomUUID } from 'node:crypto';
/** Metadata-only Sentry envelopes: no exceptions, request data, tenant IDs or breadcrumbs. */
export function createSentryReporter(dsn: string | undefined, request: typeof fetch = fetch) {
  if (!dsn) return undefined;
  const url = new URL(dsn);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{32}$/i.test(url.username) ||
    !/^\/\d+$/.test(url.pathname) ||
    !/^[a-z0-9.-]+\.ingest(?:\.[a-z]+)?\.sentry\.io$/.test(url.hostname)
  )
    throw new Error('SENTRY_DSN_INVALID');
  const endpoint = `https://${url.hostname}/api${url.pathname}/envelope/`;
  let pending = 0;
  let window = 0;
  let sent = 0;
  return async (event: { service: string; event: string; code?: string }) => {
    const minute = Math.floor(Date.now() / 60000);
    if (window !== minute) {
      window = minute;
      sent = 0;
    }
    if (pending >= 2 || sent >= 10) return;
    pending++;
    sent++;
    try {
      const id = randomUUID().replaceAll('-', '');
      const safe = (value: string) => (/^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : 'REDACTED');
      const payload = {
        event_id: id,
        timestamp: Date.now() / 1000,
        platform: 'node',
        level: 'error',
        message: safe(event.event),
        tags: { service: safe(event.service), code: safe(event.code ?? 'UNKNOWN') },
      };
      const body = [
        JSON.stringify({ event_id: id, dsn, sent_at: new Date().toISOString() }),
        JSON.stringify({ type: 'event' }),
        JSON.stringify(payload),
        '',
      ].join('\n');
      const response = await request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-sentry-envelope' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
      await response.body?.cancel();
    } catch {
      /* Optional telemetry never prevents a run or recursively logs failures. */
    } finally {
      pending--;
    }
  };
}
