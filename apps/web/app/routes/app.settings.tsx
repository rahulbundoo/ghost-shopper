import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { readAutomationConfig, readEmailConfig } from '@ghostshopper/config';
import { merchantRead } from '../merchant.server';
import { NotificationSettingsView } from '../components/notification-settings';
export function loader({ request }: LoaderFunctionArgs) {
  return merchantRead(request, async (service) => {
    const [settings, history] = await Promise.all([
      service.getNotificationSettings(),
      service.listEmailHistory(),
    ]);
    let emailConfigured = false;
    let schedulerEnabled = false;
    try {
      emailConfigured = readEmailConfig(process.env) !== null;
    } catch {
      /* Report not configured; never expose secrets. */
    }
    try {
      schedulerEnabled = readAutomationConfig(process.env).schedulerEnabled;
    } catch {
      /* Invalid means unavailable. */
    }
    return { settings, history, emailConfigured, schedulerEnabled };
  });
}
export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  return <NotificationSettingsView key={data.settings?.version ?? 0} {...data} />;
}
export { PageError as ErrorBoundary } from '../components/merchant';
