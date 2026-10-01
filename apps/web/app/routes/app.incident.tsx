import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { merchantRead, pageQuery, pageResult, required } from '../merchant.server';
import { Empty, Pagination, Panel, Status } from '../components/merchant';
import { timestamp } from '../merchant-model';
export function loader({ request, params }: LoaderFunctionArgs) {
  return merchantRead(request, async (service) => {
    const query = pageQuery(request);
    const incident = required(await service.getIncident(params.incidentId));
    return {
      incident,
      ...pageResult(await service.listIncidentOccurrences(incident.id, query), query.offset),
    };
  });
}
export default function IncidentDetails() {
  const data = useLoaderData<typeof loader>();
  const item = data.incident;
  return (
    <s-page heading="Incident details">
      <s-link slot="breadcrumb-actions" href="/app/incidents">
        Incidents
      </s-link>
      <Panel title={item.title}>
        <Status value={item.status} /> <Status value={item.severity} />
        <p className="gs-kicker">DETECTED</p>
        <p>{item.description}</p>
        <p>
          {item.occurrenceCount} occurrences · First seen {timestamp(item.firstSeenAt)} · Last seen{' '}
          {timestamp(item.lastSeenAt)}
        </p>
        <Link to={`/app/runs/${item.lastSeenRunId}`}>Latest affected run</Link>
        <p>
          <Link to={`/app/monitors/${item.monitorId}`}>View monitor</Link>
        </p>
        {item.resolvedRunId ? (
          <p>
            Resolved {timestamp(item.resolvedAt)} ·{' '}
            <Link to={`/app/runs/${item.resolvedRunId}`}>View recovery run</Link>
          </p>
        ) : (
          <p>Still open. Disabling or editing a monitor does not prove this incident recovered.</p>
        )}
      </Panel>
      <Panel title="Occurrences">
        {data.items.length ? (
          <ul className="gs-list">
            {data.items.map((occurrence) => (
              <li key={occurrence.id}>
                <Link to={`/app/runs/${occurrence.runId}`}>{timestamp(occurrence.createdAt)}</Link>{' '}
                · Attempt {occurrence.attempt}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No occurrences on this page.</Empty>
        )}
        <Pagination {...data} />
      </Panel>
    </s-page>
  );
}
export { PageError as ErrorBoundary } from '../components/merchant';
