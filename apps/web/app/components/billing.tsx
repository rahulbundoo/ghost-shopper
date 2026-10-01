import { useState } from 'react';
import { useRevalidator } from 'react-router';
import type { BillingPolicy } from '@ghostshopper/domain';
import { merchantApi, timestamp, label } from '../merchant-model';
import { Panel, useMutation } from './merchant';
export interface BillingViewData {
  enabled: boolean;
  syncFailed?: boolean;
  summary?: {
    status: string;
    trialEndsAt: string | Date;
    periodEnd: string | Date | null;
    verifiedAt: string | Date | null;
    used: number;
    limit: number;
    eligible: boolean;
    canCancel: boolean;
    policy: BillingPolicy;
  };
}
export function BillingView({ enabled, summary, syncFailed }: BillingViewData) {
  const mutation = useMutation();
  const refresh = useRevalidator();
  const [approval, setApproval] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const act = (action: 'checkout' | 'cancel' | 'refresh') =>
    void mutation.perform(async () => {
      const result = await merchantApi<{ confirmationUrl?: string }>('billing', 'POST', { action });
      setApproval(result.confirmationUrl ?? null);
      await refresh.revalidate();
    });
  if (!enabled || !summary)
    return (
      <s-page heading="Billing">
        <Panel title="Billing not enabled">
          <p>No subscription charges or run limits are enabled in this deployment.</p>
        </Panel>
      </s-page>
    );
  const { policy } = summary;
  return (
    <s-page heading="Billing">
      <Panel title="Plan and usage">
        <p>
          {policy.test
            ? 'Test billing — no real charge.'
            : 'Live billing — Shopify approval is required.'}
        </p>
        <p>
          GhostShopper Standard: USD {policy.priceUsd} every 30 days, including{' '}
          {policy.paidRunLimit} runs.
        </p>
        <p>
          Free trial: {policy.trialDays} days and {policy.trialRunLimit} runs. No automatic upgrade.
        </p>
        <p>
          Status: {label(summary.status)}.{' '}
          {summary.eligible
            ? 'Runs available.'
            : 'New runs are paused until your allowance or subscription is available.'}
        </p>
        <p>
          {summary.used} / {summary.limit} runs in the current allowance.
        </p>
        <p>
          Trial ends: {timestamp(summary.trialEndsAt)}. Paid period ends:{' '}
          {timestamp(summary.periodEnd)}.
        </p>
        <p>Last verified with Shopify: {timestamp(summary.verifiedAt)}.</p>
        {syncFailed && (
          <p role="alert">
            Shopify billing could not be verified. Cached access expires after one hour; refresh to
            retry.
          </p>
        )}
        <p>
          Every admitted run counts once, including failed or cancelled runs. Worker retries do not
          count again. No overage charges.
        </p>
      </Panel>
      <Panel title="Manage subscription">
        <p>
          Upgrading starts paid billing immediately and ends the free allowance. Review the charge
          on Shopify before approving.
        </p>
        <fieldset disabled={mutation.busy}>
          {!summary.canCancel && (
            <button className="gs-button" onClick={() => act('checkout')}>
              Review paid plan on Shopify
            </button>
          )}
          <button className="gs-button" onClick={() => act('refresh')}>
            Refresh billing status
          </button>
          {summary.canCancel && (
            <>
              <label className="gs-checkbox">
                <input
                  type="checkbox"
                  checked={confirmCancel}
                  onChange={(event) => setConfirmCancel(event.target.checked)}
                />
                I understand cancellation stops new runs immediately, with no prorated refund.
              </label>
              <button className="gs-button" disabled={!confirmCancel} onClick={() => act('cancel')}>
                Cancel subscription
              </button>
            </>
          )}
        </fieldset>
        {approval && (
          <p>
            <a href={approval} target="_top" rel="noreferrer">
              Continue to Shopify approval
            </a>
          </p>
        )}
        {mutation.error && <p role="alert">{mutation.error}</p>}
        <p>
          Existing reports remain available. Manage the subscription here or uninstall through
          Shopify.
        </p>
      </Panel>
    </s-page>
  );
}
