import type { Artifact, Incident, TestRun } from '@ghostshopper/domain';

export function label(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (first) => first.toUpperCase());
}
export function timestamp(value: Date | string | null): string {
  return value
    ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
    : 'Not recorded';
}
export function runSummary(run: Pick<TestRun, 'status' | 'outcome'>): string {
  if (run.status === 'ERROR') return 'Check could not complete';
  if (run.status === 'CANCELLED') return 'Check cancelled';
  if (run.status !== 'COMPLETED') return label(run.status);
  return run.outcome === 'PASSED'
    ? 'Journey passed'
    : run.outcome === 'FAILED'
      ? 'Purchase flow failed'
      : run.outcome === 'WARNING'
        ? 'Needs review'
        : 'Result unavailable';
}
/** A recent sample is not a store-wide health score or proof that all monitors passed. */
export function overviewSummary(runs: readonly TestRun[], incidents: readonly Incident[]): string {
  if (incidents.length) return 'Open incidents need attention';
  if (!runs.length) return 'No checks yet';
  const latest = runs[0];
  if (!latest || latest.status !== 'COMPLETED') return 'Store health not confirmed';
  return latest.outcome === 'PASSED' ? 'Latest journey passed' : 'Latest journey needs attention';
}
export function evidenceAvailable(
  artifact: Pick<Artifact, 'status' | 'expiresAt'>,
  now = Date.now(),
) {
  return artifact.status === 'READY' && new Date(artifact.expiresAt).getTime() > now;
}

export class MerchantApiError extends Error {
  constructor(readonly status: number) {
    super(
      status === 429
        ? 'Too many requests. Wait a minute before trying again.'
        : status === 402
          ? 'Your trial, subscription verification, or run allowance needs attention. Open Billing.'
          : status === 409
            ? 'The record changed, the monitor is disabled, or a run is already active. Reload before trying again.'
            : status === 400
              ? 'Check the form values and try again.'
              : status === 401 || status === 403
                ? 'Your session is unavailable. Reopen GhostShopper from Shopify admin.'
                : status === 404
                  ? 'This resource is unavailable or its evidence has expired.'
                  : 'The request could not be confirmed. Refresh the page before retrying to avoid a duplicate.',
    );
  }
}
/** App Bridge authenticates same-origin fetch. Never retry a mutation automatically. */
export async function merchantApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/app/api/${path}`, {
    method,
    cache: 'no-store',
    redirect: 'error',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new MerchantApiError(response.status);
  if (!response.headers.get('Content-Type')?.includes('application/json'))
    throw new MerchantApiError(401);
  return (await response.json()) as T;
}
