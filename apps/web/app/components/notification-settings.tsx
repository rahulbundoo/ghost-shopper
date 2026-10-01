import { useState } from 'react';
import { Link, useRevalidator } from 'react-router';
import type { NotificationSettings, EmailHistory } from '@ghostshopper/domain';
import { notificationSettingsSchema } from '@ghostshopper/contracts';
import { merchantApi, label, timestamp } from '../merchant-model';
import { Empty, Panel, useMutation } from './merchant';
export function NotificationSettingsView({
  settings,
  history,
  emailConfigured,
  schedulerEnabled,
}: {
  settings: NotificationSettings | null;
  history: EmailHistory[];
  emailConfigured: boolean;
  schedulerEnabled: boolean;
}) {
  const mutation = useMutation();
  const refresh = useRevalidator();
  const [invalid, setInvalid] = useState(false);
  return (
    <s-page heading="Settings">
      <Panel title="Automatic monitoring">
        <p>
          Scheduling is {schedulerEnabled ? 'enabled' : 'disabled'} in this web deployment
          configuration. The runner must use the same configuration and be online.
        </p>
        <p>
          Enabled monitors follow their saved frequency. New monitors are first eligible on the next
          scheduler scan; re-enabled or rescheduled monitors wait one full interval. Missed
          intervals are skipped after downtime.
        </p>
        <p>
          Only one active run per monitor is allowed. Run now remains available regardless of the
          scheduling setting.
        </p>
        <Link to="/app/monitors">Manage monitors</Link>
      </Panel>
      <Panel title="Email notifications">
        <p>
          Email delivery is {emailConfigured ? 'configured' : 'not configured'} in this web
          deployment. The runner sends messages only when it is configured too.
        </p>
        <p>
          Opt in to receive new or reopened HIGH/CRITICAL detected incidents. Repeated failures and
          AI suggestions do not send more alerts. Messages are grouped by run, with at most one send
          attempt per shop every 15 minutes. Obsolete unsent alerts are suppressed.
        </p>
        <form
          className="gs-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const parsed = notificationSettingsSchema.safeParse({
              email: form.get('email'),
              enabled: form.get('enabled') === 'on',
              recoveryEnabled: form.get('recoveryEnabled') === 'on',
              version: settings?.version ?? 0,
            });
            setInvalid(!parsed.success);
            if (!parsed.success) return;
            void mutation.perform(async () => {
              await merchantApi('notifications', 'PATCH', parsed.data);
              await refresh.revalidate();
            });
          }}
        >
          <fieldset disabled={mutation.busy}>
            <label>
              Notification email
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                defaultValue={settings?.email ?? ''}
                autoComplete="email"
              />
            </label>
            <label className="gs-checkbox">
              <input type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? false} />I
              authorize alerts to this email address
            </label>
            <label className="gs-checkbox">
              <input
                type="checkbox"
                name="recoveryEnabled"
                defaultChecked={settings?.recoveryEnabled ?? true}
              />
              Send recovery notifications after an alerted journey recovers
            </label>
            <p className="gs-muted">
              Saving changes cancels pending messages to the previous settings. Already submitted
              emails cannot be recalled. No test email is sent by this form.
            </p>
            <button className="gs-button" type="submit">
              {mutation.busy ? 'Saving…' : 'Save notifications'}
            </button>
          </fieldset>
          {invalid && <p role="alert">Enter a valid notification email.</p>}
          {mutation.error && <p role="alert">{mutation.error} Reload settings before retrying.</p>}
        </form>
      </Panel>
      <Panel title="Recent notification activity">
        <p>
          Latest 10 records. Accepted means accepted by the provider, not proof of inbox delivery.
        </p>
        {history.length ? (
          <ul className="gs-list">
            {history.map((email) => (
              <li key={email.id}>
                <strong>
                  {label(email.kind)} ·{' '}
                  {email.status === 'SENT' ? 'Accepted by provider' : label(email.status)}
                </strong>
                <p>{timestamp(email.createdAt)}</p>
                <Link to={`/app/runs/${email.runId}`}>View run</Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No notification activity recorded.</Empty>
        )}
      </Panel>
    </s-page>
  );
}
