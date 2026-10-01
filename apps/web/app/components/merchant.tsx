import { useRef, useState, type ReactNode } from 'react';
import { Link, isRouteErrorResponse, useRevalidator, useRouteError } from 'react-router';
import { label, MerchantApiError } from '../merchant-model';

export function Status({ value }: { value: string }) {
  const tone = ['PASSED', 'RESOLVED', 'GOOD'].includes(value)
    ? 'success'
    : ['FAILED', 'ERROR', 'CRITICAL', 'HIGH', 'BAD'].includes(value)
      ? 'critical'
      : ['WARNING', 'OPEN', 'MEDIUM'].includes(value)
        ? 'warning'
        : 'neutral';
  return <s-badge tone={tone}>{label(value)}</s-badge>;
}
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <s-section heading={title}>
      <div className="gs-content">{children}</div>
    </s-section>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="gs-empty">{children}</p>;
}
export function Refresh() {
  const refresh = useRevalidator();
  return (
    <s-button onClick={() => void refresh.revalidate()} disabled={refresh.state !== 'idle'}>
      {refresh.state === 'idle' ? 'Refresh results' : 'Refreshing…'}
    </s-button>
  );
}
export function Pagination({
  offset,
  hasNext,
  status,
}: {
  offset: number;
  hasNext: boolean;
  status?: string;
}) {
  const href = (next: number) => `?offset=${next}${status ? `&status=${status}` : ''}`;
  return (
    <nav className="gs-pagination" aria-label="Pagination">
      {offset > 0 && <Link to={href(Math.max(0, offset - 25))}>Previous page</Link>}
      <span>Page {Math.floor(offset / 25) + 1}</span>
      {hasNext && <Link to={href(offset + 25)}>Next page</Link>}
    </nav>
  );
}
export function PageError() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <s-page heading="Unable to show this page">
      <Panel title={status === 404 ? 'Not found' : 'Page unavailable'}>
        <p role="alert">
          {status === 400
            ? 'The page address or filters are invalid.'
            : status === 401 || status === 403
              ? 'Reopen GhostShopper from Shopify admin to restore your session.'
              : status === 404
                ? 'This item is unavailable in your store.'
                : 'Please try again. Your saved data has not been changed.'}
        </p>
        <Link to="/app">Return to overview</Link>
      </Panel>
    </s-page>
  );
}
export function useMutation() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function perform(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof MerchantApiError
          ? cause.message
          : 'The request could not be confirmed. Refresh before retrying to avoid a duplicate.',
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, error, perform };
}
