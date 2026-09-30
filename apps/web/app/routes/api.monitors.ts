import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { jsonResponse, listQuery, monitoringRequest, readJson } from '../monitoring.server';
export function loader({ request }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) =>
    jsonResponse({ monitors: await service.listMonitors(listQuery(request)) }),
  );
}
export function action({ request }: ActionFunctionArgs) {
  return monitoringRequest(request, ['POST'], async (service) =>
    jsonResponse({ monitor: await service.createMonitor(await readJson(request)) }, 201),
  );
}
