import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { merchantRead, pageQuery, pageResult } from '../merchant.server';
import { Empty, Pagination, Panel, Refresh, Status } from '../components/merchant';
import { label, runSummary, timestamp } from '../merchant-model';
export function loader({ request }: LoaderFunctionArgs) {
  return merchantRead(request, async (service) => {
    const query = pageQuery(request);
    return pageResult(await service.listTestRuns(query), query.offset);
  });
}
export default function Runs() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Run history">
      <Panel title="Requested checks">
        <Refresh />
        {!data.items.length ? (
          <Empty>
            No runs on this page. Open a <Link to="/app/monitors">monitor</Link> to request a check.
          </Empty>
        ) : (
          <div className="gs-table-wrap">
            <table>
              <caption className="gs-sr-only">Run history, newest requests first</caption>
              <thead>
                <tr>
                  <th>Requested (UTC)</th>
                  <th>Device</th>
                  <th>Result</th>
                  <th>Monitor</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link to={`/app/runs/${run.id}`}>{timestamp(run.createdAt)}</Link>
                    </td>
                    <td>{label(run.device)}</td>
                    <td>
                      <Status value={run.outcome ?? run.status} />
                      <p>{runSummary(run)}</p>
                    </td>
                    <td>
                      <Link to={`/app/monitors/${run.monitorId}`}>
                        Configuration v{run.monitorVersion}
                      </Link>
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
