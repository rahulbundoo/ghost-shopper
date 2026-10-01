import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { incidentStatus, merchantRead, pageQuery, pageResult } from '../merchant.server';
import { Empty, Pagination, Panel, Refresh, Status } from '../components/merchant';
import { timestamp } from '../merchant-model';
export function loader({ request }: LoaderFunctionArgs) {
  return merchantRead(request, async (service) => {
    const query = pageQuery(request);
    const status = incidentStatus(request);
    return {
      ...pageResult(await service.listIncidents({ ...query, status }), query.offset),
      status,
    };
  });
}
export default function Incidents() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Incidents">
      <Panel title={data.status === 'OPEN' ? 'Active incidents' : 'Resolved incidents'}>
        <nav className="gs-pagination" aria-label="Incident status">
          <Link to="?status=OPEN" aria-current={data.status === 'OPEN' ? 'page' : undefined}>
            Open
          </Link>
          <Link
            to="?status=RESOLVED"
            aria-current={data.status === 'RESOLVED' ? 'page' : undefined}
          >
            Resolved
          </Link>
          <Refresh />
        </nav>
        <p>
          Repeated detected failures are grouped. Resolution requires a later, complete passing
          check of the same journey configuration.
        </p>
        {!data.items.length ? (
          <Empty>No {data.status.toLowerCase()} incidents on this page.</Empty>
        ) : (
          <ul className="gs-list">
            {data.items.map((item) => (
              <li key={item.id}>
                <Status value={item.severity} />{' '}
                <Link to={`/app/incidents/${item.id}`}>{item.title}</Link>
                <p>{item.description}</p>
                <p>
                  {item.occurrenceCount} occurrences · First seen {timestamp(item.firstSeenAt)} ·
                  Last seen {timestamp(item.lastSeenAt)}
                </p>
                <Status value={item.status} />
              </li>
            ))}
          </ul>
        )}
        <Pagination {...data} />
      </Panel>
    </s-page>
  );
}
export { PageError as ErrorBoundary } from '../components/merchant';
