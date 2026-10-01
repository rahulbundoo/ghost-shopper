import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { merchantRead, pageQuery, pageResult } from '../merchant.server';
import { Empty, Pagination, Panel, Status } from '../components/merchant';
import { label } from '../merchant-model';
export function loader({ request }: LoaderFunctionArgs) {
  return merchantRead(request, async (service) => {
    const query = pageQuery(request);
    return pageResult(await service.listMonitors(query), query.offset);
  });
}
export default function Monitors() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Monitors">
      <s-button href="/app/monitors/new" slot="primary-action" variant="primary">
        Create monitor
      </s-button>
      <Panel title="Your purchase journeys">
        <p>
          A monitor checks one product on one device. Enabled monitors run at their saved frequency
          when deployment scheduling is enabled. Check Settings for deployment configuration.
        </p>
        {!data.items.length ? (
          <Empty>
            No monitors on this page. <Link to="/app/monitors/new">Create a monitor</Link>.
          </Empty>
        ) : (
          <div className="gs-table-wrap">
            <table>
              <caption className="gs-sr-only">Configured monitors</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Device</th>
                  <th>Frequency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((monitor) => (
                  <tr key={monitor.id}>
                    <td>
                      <Link to={`/app/monitors/${monitor.id}`}>{monitor.name}</Link>
                    </td>
                    <td>{label(monitor.device)}</td>
                    <td>{label(monitor.frequency)}</td>
                    <td>
                      <Status value={monitor.enabled ? 'ENABLED' : 'DISABLED'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination {...data} />
      </Panel>
    </s-page>
  );
}
export { PageError as ErrorBoundary } from '../components/merchant';
