import type { LoaderFunctionArgs } from 'react-router';
import { jsonResponse, listQuery, monitoringRequest } from '../monitoring.server.js';
export function loader({ request }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) =>
    jsonResponse({ incidents: await service.listIncidents(listQuery(request)) }),
  );
}
