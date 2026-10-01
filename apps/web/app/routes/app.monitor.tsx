import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { merchantRead, required } from '../merchant.server';
import { MonitorEditor } from '../components/monitor-editor';
export function loader({ request, params }: LoaderFunctionArgs) {
  return merchantRead(request, async (service) =>
    required(await service.getMonitor(params.monitorId)),
  );
}
export default function EditMonitor() {
  const monitor = useLoaderData<typeof loader>();
  return <MonitorEditor key={`${monitor.id}:${monitor.version}`} monitor={monitor} />;
}
export { PageError as ErrorBoundary } from '../components/merchant';
