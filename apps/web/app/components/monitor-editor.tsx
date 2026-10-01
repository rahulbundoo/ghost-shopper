import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Monitor } from '@ghostshopper/domain';
import { createMonitorSchema } from '@ghostshopper/contracts';
import { merchantApi } from '../merchant-model';
import { Panel, useMutation } from './merchant';

export function MonitorEditor({ monitor }: { monitor: Monitor | null }) {
  const navigate = useNavigate();
  const mutation = useMutation();
  const [validation, setValidation] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  return (
    <s-page heading={monitor ? `Monitor: ${monitor.name}` : 'Create monitor'}>
      <s-link slot="breadcrumb-actions" href="/app/monitors">
        Monitors
      </s-link>
      <Panel title="Purchase journey configuration">
        <p>GhostShopper visits your public storefront and stops before payment.</p>
        <form
          className="gs-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const input = createMonitorSchema.safeParse({
              name: form.get('name'),
              productId: form.get('productId'),
              variantId: form.get('variantId') || null,
              device: form.get('device'),
              frequency: form.get('frequency'),
              enabled: form.get('enabled') === 'on',
            });
            setSaved(false);
            if (!input.success) {
              setValidation([...new Set(input.error.issues.map((issue) => String(issue.path[0])))]);
              return;
            }
            setValidation([]);
            void mutation.perform(async () => {
              const result = await merchantApi<{ monitor: Monitor }>(
                monitor ? `monitors/${monitor.id}` : 'monitors',
                monitor ? 'PATCH' : 'POST',
                { ...input.data, ...(monitor ? { version: monitor.version } : {}) },
              );
              setSaved(true);
              await navigate(`/app/monitors/${result.monitor.id}`);
            });
          }}
        >
          <fieldset disabled={mutation.busy}>
            <label>
              Monitor name
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={monitor?.name ?? ''}
                autoComplete="off"
              />
            </label>
            <label>
              Shopify product ID
              <input
                name="productId"
                required
                pattern="gid://shopify/Product/[1-9][0-9]*"
                defaultValue={monitor?.productId ?? ''}
                placeholder="gid://shopify/Product/123456789"
                aria-describedby="product-help"
              />
            </label>
            <p id="product-help" className="gs-muted">
              Open a product in Shopify admin. Copy the number at the end of its address and enter
              it as gid://shopify/Product/NUMBER. Choose a product published to your online store.
              No extra Shopify permissions are requested.
            </p>
            <label>
              Variant ID (optional)
              <input
                name="variantId"
                pattern="gid://shopify/ProductVariant/[1-9][0-9]*"
                defaultValue={monitor?.variantId ?? ''}
                placeholder="gid://shopify/ProductVariant/123456789"
                aria-describedby="variant-help"
              />
            </label>
            <p id="variant-help" className="gs-muted">
              Leave blank to use the storefront’s default selection. When changing product, clear or
              replace its variant too.
            </p>
            <label htmlFor="monitor-device">Device</label>
            <select id="monitor-device" name="device" defaultValue={monitor?.device ?? 'DESKTOP'}>
              <option value="DESKTOP">Desktop Chromium</option>
              <option value="MOBILE">Mobile Chromium</option>
            </select>
            <label htmlFor="monitor-frequency">Frequency</label>
            <select
              id="monitor-frequency"
              name="frequency"
              defaultValue={monitor?.frequency ?? 'DAILY'}
            >
              <option value="HOURLY">Hourly</option>
              <option value="EVERY_SIX_HOURS">Every six hours</option>
              <option value="DAILY">Daily</option>
            </select>
            <p className="gs-muted">
              Enabled monitors use this frequency when deployment scheduling is enabled and the
              runner is online. Email alerts require opt-in in Settings.
            </p>
            <label className="gs-checkbox">
              <input type="checkbox" name="enabled" defaultChecked={monitor?.enabled ?? true} />
              Enabled (allows manual checks)
            </label>
            <button className="gs-button" type="submit">
              {mutation.busy ? 'Saving…' : 'Save monitor'}
            </button>
            <Link to="/app/monitors">Cancel</Link>
          </fieldset>
          {validation.length > 0 && (
            <p role="alert">Check these fields: {validation.join(', ')}.</p>
          )}
        </form>
        {saved && <p role="status">Monitor saved.</p>}
        {mutation.error && (
          <p role="alert">
            {mutation.error} <a href="">Reload saved configuration</a>
          </p>
        )}
      </Panel>
      {monitor && (
        <Panel title="Run a check">
          <p>
            A manual check uses the saved configuration, not unsaved edits. Disabled monitors cannot
            run.
          </p>
          <s-button
            disabled={!monitor.enabled || mutation.busy}
            onClick={() =>
              void mutation.perform(async () => {
                const result = await merchantApi<{ run: { id: string } }>('runs', 'POST', {
                  monitorId: monitor.id,
                });
                await navigate(`/app/runs/${result.run.id}`);
              })
            }
          >
            Run now
          </s-button>
        </Panel>
      )}
    </s-page>
  );
}
