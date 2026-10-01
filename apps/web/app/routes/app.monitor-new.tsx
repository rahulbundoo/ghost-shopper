import type { LoaderFunctionArgs } from 'react-router';
import { merchantRead } from '../merchant.server';
import { MonitorEditor } from '../components/monitor-editor';
export function loader({ request }: LoaderFunctionArgs) {
  return merchantRead(request, async (service) => {
    await service.getShop();
    return null;
  });
}
export default function NewMonitor() {
  return <MonitorEditor monitor={null} />;
}
export { PageError as ErrorBoundary } from '../components/merchant';
