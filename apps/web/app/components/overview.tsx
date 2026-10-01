import { Link } from 'react-router';
import type { Incident, RunAnalysis, TestRun } from '@ghostshopper/domain';
import { overviewSummary, runSummary, timestamp } from '../merchant-model';
import { Empty, Panel, Refresh, Status } from './merchant';

export interface OverviewData {
  name: string | null;
  domain: string;
  hasMonitors: boolean;
  runs: TestRun[];
  incidents: Incident[];
  analysis: RunAnalysis | null;
}
export function Overview({ data }: { data: OverviewData }) {
  const latest = data.runs[0];
  return (
    <s-page heading="Store overview">
      <s-button slot="primary-action" href="/app/monitors/new" variant="primary">
        Create monitor
      </s-button>
      <Panel title={data.name ?? data.domain}>
        <p className="gs-kicker">PURCHASE JOURNEY HEALTH</p>
        <h2>{overviewSummary(data.runs, data.incidents)}</h2>
        <p>Checks stop at checkout initiation. No payment is submitted.</p>
        <p className="gs-muted">
          Recent activity is a snapshot, not a guarantee of store-wide health. Check Settings for
          scheduling and email configuration.
        </p>
        <Refresh />
      </Panel>
      {!data.hasMonitors && (
        <Panel title="Start with one product">
          <p>Create a desktop or mobile monitor, then request a check from its settings.</p>
          <Link to="/app/monitors/new">Create your first monitor</Link>
        </Panel>
      )}
      <div className="gs-grid">
        {(['DESKTOP', 'MOBILE'] as const).map((device) => {
          const run = data.runs.find((item) => item.device === device);
          return (
            <Panel key={device} title={device === 'DESKTOP' ? 'Desktop' : 'Mobile'}>
              {run ? (
                <>
                  <Status value={run.outcome ?? run.status} />
                  <p>{runSummary(run)}</p>
                  <p className="gs-muted">Requested {timestamp(run.createdAt)}</p>
                  <Link to={`/app/runs/${run.id}`}>View {device.toLowerCase()} check</Link>
                </>
              ) : (
                <Empty>No {device.toLowerCase()} check in the latest 25 runs.</Empty>
              )}
            </Panel>
          );
        })}
      </div>
      <Panel title="Latest run">
        {latest ? (
          <>
            <p>
              {runSummary(latest)} · {timestamp(latest.createdAt)}
            </p>
            <Link to={`/app/runs/${latest.id}`}>View journey and evidence</Link>
          </>
        ) : (
          <Empty>No checks have been requested yet.</Empty>
        )}
      </Panel>
      <Panel title="Active incidents">
        {data.incidents.length ? (
          <>
            <p>
              Showing {Math.min(data.incidents.length, 5)} most recently observed open incidents
              {data.incidents.length > 5 ? '; more are available' : ''}.
            </p>
            <ul className="gs-list">
              {data.incidents.slice(0, 5).map((item) => (
                <li key={item.id}>
                  <Status value={item.severity} />{' '}
                  <Link to={`/app/incidents/${item.id}`}>{item.title}</Link>
                  <p>
                    {item.occurrenceCount} occurrences · Last seen {timestamp(item.lastSeenAt)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty>
            No open incidents recorded. This does not establish full monitoring coverage.
          </Empty>
        )}
        <Link to="/app/incidents">View incidents</Link>
      </Panel>
      <Panel title="Important findings from the latest run">
        <p className="gs-kicker">DETECTED · Technical facts</p>
        {data.analysis?.findings.length ? (
          <ul className="gs-list">
            {[...data.analysis.findings]
              .sort(
                (a, b) =>
                  ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(a.severity) -
                  ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].indexOf(b.severity),
              )
              .slice(0, 5)
              .map((finding) => (
                <li key={finding.id}>
                  <Status value={finding.severity} /> <strong>{finding.title}</strong>
                  <p>{finding.description}</p>
                </li>
              ))}
          </ul>
        ) : (
          <Empty>
            {data.analysis?.complete
              ? 'No technical findings in the latest run.'
              : 'Complete technical analysis is not available for the latest run.'}
          </Empty>
        )}
      </Panel>
    </s-page>
  );
}
