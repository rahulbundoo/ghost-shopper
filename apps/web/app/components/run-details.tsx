import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type {
  AiAnalysisRecord,
  Artifact,
  RunAnalysis,
  RunStep,
  TestRun,
} from '@ghostshopper/domain';
import { evidenceAvailable, label, merchantApi, runSummary, timestamp } from '../merchant-model';
import { Empty, Panel, Refresh, Status, useMutation } from './merchant';

export interface RunDetailsData {
  run: TestRun;
  steps: RunStep[];
  artifacts: Artifact[];
  analyses: RunAnalysis[];
  aiAnalyses: AiAnalysisRecord[];
}
export function Evidence({ artifact }: { artifact: Artifact }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const mutation = useMutation();
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(
      () => setLink(null),
      Math.max(0, new Date(link.expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [link]);
  const available = evidenceAvailable(artifact);
  return (
    <div className="gs-evidence" id={`evidence-${artifact.id}`}>
      <strong>
        {label(artifact.type)}
        {artifact.stepPosition !== null ? ` · Step ${artifact.stepPosition + 1}` : ''}
      </strong>
      <p className="gs-muted">
        {Math.ceil(artifact.sizeBytes / 1024)} KB · Retained until {timestamp(artifact.expiresAt)}
      </p>
      {!available ? (
        <p>
          Evidence {artifact.status === 'READY' ? 'expired' : label(artifact.status).toLowerCase()}.
          It cannot be opened.
        </p>
      ) : (
        <s-button
          disabled={mutation.busy}
          onClick={() =>
            void mutation.perform(async () => {
              setLink(
                await merchantApi<{ url: string; expiresAt: string }>(
                  `artifacts/${artifact.id}/download`,
                ),
              );
            })
          }
        >
          {mutation.busy ? 'Preparing…' : link ? 'Renew private link' : 'Open evidence'}
        </s-button>
      )}
      {mutation.error && <p role="alert">{mutation.error}</p>}
      {link && (
        <>
          <p>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              Download {label(artifact.type).toLowerCase()}
            </a>{' '}
            · Link expires shortly.
          </p>
          {artifact.type === 'SCREENSHOT' && (
            <img
              src={link.url}
              alt={`Storefront screenshot at step ${(artifact.stepPosition ?? 0) + 1}`}
              referrerPolicy="no-referrer"
              onError={() => setLink(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
export function RunDetails({ data }: { data: RunDetailsData }) {
  const { run } = data;
  const [selected, setSelected] = useState<number | null>(null);
  const attempt = selected ?? Math.max(1, run.attemptCount);
  const analysis = data.analyses.find((item) => item.attempt === attempt);
  const ai = data.aiAnalyses.find((item) => item.attempt === attempt);
  const steps = data.steps.filter((item) => item.attempt === attempt);
  const artifacts = data.artifacts.filter((item) => item.attempt === attempt);
  return (
    <s-page heading="Run details">
      <s-link slot="breadcrumb-actions" href="/app/runs">
        Run history
      </s-link>
      <Panel title={runSummary(run)}>
        <Status value={run.outcome ?? run.status} />
        <p>
          {label(run.device)} · Requested {timestamp(run.createdAt)}
        </p>
        <p>
          Started {timestamp(run.startedAt)} · Finished {timestamp(run.finishedAt)}
        </p>
        <p>
          Saved configuration v{run.monitorVersion} · Product {run.productId}
        </p>
        <Link to={`/app/monitors/${run.monitorId}`}>View monitor</Link>
        <p className="gs-muted">
          Results update when you refresh. A queued run may be waiting for dispatch or a runner.
        </p>
        <Refresh />
        {run.errorCode && (
          <p role="status">
            Diagnostic code: {run.errorCode}. This is not proof of a storefront failure.
          </p>
        )}
      </Panel>
      <Panel title="Journey timeline">
        <label htmlFor="run-attempt">Attempt </label>
        <select
          id="run-attempt"
          value={attempt}
          onChange={(event) => setSelected(Number(event.target.value))}
        >
          {Array.from({ length: Math.max(1, run.attemptCount) }, (_, index) => (
            <option key={index + 1} value={index + 1}>
              {index + 1}
              {index + 1 === run.attemptCount ? ' (latest)' : ''}
            </option>
          ))}
        </select>
        <p>All evidence and analysis below belong to attempt {attempt}.</p>
        {!steps.length ? (
          <Empty>No recorded steps for this attempt yet.</Empty>
        ) : (
          <ol className="gs-list">
            {steps.map((step) => (
              <li key={step.id}>
                <strong>
                  {step.position + 1}. {label(step.action)}
                </strong>{' '}
                <Status value={step.status} />
                <p>
                  {(step.durationMs / 1000).toFixed(2)} seconds · {timestamp(step.startedAt)}
                </p>
                {step.errorCode && (
                  <p>
                    {label(step.errorCode)}
                    {step.errorMessage ? `: ${step.errorMessage}` : ''}
                  </p>
                )}
                {step.currentUrl && <p className="gs-muted gs-break">{step.currentUrl}</p>}
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel title="Detected findings">
        <p className="gs-kicker">DETECTED · Technical facts</p>
        <p>
          {analysis?.score !== null && analysis?.score !== undefined
            ? `Technical score: ${analysis.score}/100`
            : 'Technical score unavailable'}
        </p>
        {analysis && !analysis.complete && (
          <p>Evidence is incomplete. No passing health score is implied.</p>
        )}
        {analysis?.findings.length ? (
          <ul className="gs-list">
            {analysis.findings.map((finding) => (
              <li key={finding.id}>
                <Status value={finding.severity} /> <strong>{finding.title}</strong>
                <p>{finding.description}</p>
                <p>
                  {finding.occurrences} observations
                  {finding.stepPosition !== null ? ` · Step ${finding.stepPosition + 1}` : ''}
                </p>
                {finding.evidenceArtifactId &&
                  artifacts.some((item) => item.id === finding.evidenceArtifactId) && (
                    <a href={`#evidence-${finding.evidenceArtifactId}`}>View evidence</a>
                  )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            {analysis?.complete
              ? 'No technical findings for this attempt.'
              : 'Complete technical findings are not available.'}
          </Empty>
        )}
      </Panel>
      <Panel title="Experience review">
        <p className="gs-kicker">AI ANALYSIS · Interpretation, not detected fact</p>
        <p>AI suggestions do not change technical results or incident status.</p>
        {ai?.status === 'SUCCEEDED' && ai.result ? (
          <>
            <Status value={ai.result.experience} />
            <p>Experience score: {ai.result.experienceScore}/100</p>
            <ul className="gs-list">
              {ai.result.findings.map((finding, index) => (
                <li key={index}>
                  <Status value={finding.severity} /> <strong>{finding.title}</strong>
                  <p>{finding.description}</p>
                  <p>Evidence interpreted: {finding.evidence}</p>
                  <p>
                    Step {finding.step + 1} · Confidence {Math.round(finding.confidence * 100)}%
                  </p>
                </li>
              ))}
            </ul>
            {!ai.result.findings.length && <Empty>No experience concerns suggested.</Empty>}
          </>
        ) : (
          <Empty>
            {ai?.status === 'RUNNING'
              ? 'AI analysis is pending. Refresh later.'
              : ai?.status === 'FAILED'
                ? 'AI analysis was unavailable. Technical results remain valid.'
                : 'No AI analysis recorded for this attempt. It may be disabled or evidence may be insufficient.'}
          </Empty>
        )}
        {ai && (
          <details>
            <summary>Analysis provenance</summary>
            <p>
              {ai.provider} · {ai.model} · {ai.promptVersion}
            </p>
            <p>
              Requested {timestamp(ai.requestedAt)} · Status {label(ai.status)}
            </p>
          </details>
        )}
      </Panel>
      <Panel title="Screenshots and diagnostics">
        <p>
          Private evidence links are short-lived. Expired evidence cannot be restored here. Console,
          network, metadata and trace exports provide diagnostic detail.
        </p>
        {artifacts.length ? (
          <div className="gs-grid">
            {artifacts.map((artifact) => (
              <Evidence key={artifact.id} artifact={artifact} />
            ))}
          </div>
        ) : (
          <Empty>No evidence recorded for this attempt.</Empty>
        )}
      </Panel>
    </s-page>
  );
}
