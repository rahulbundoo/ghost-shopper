import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { DomainError } from '@ghostshopper/domain';
import { jsonResponse, monitoringRequest, readJson } from '../monitoring.server';
export function loader({ request, params }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) => {
    const monitor = await service.getMonitor(params.monitorId);
    if (!monitor) throw new DomainError('NOT_FOUND');
    return jsonResponse({ monitor });
  });
}
export function action({ request, params }: ActionFunctionArgs) {
  return monitoringRequest(request, ['PATCH'], async (service) =>
    jsonResponse({
      monitor: await service.updateMonitor(params.monitorId, await readJson(request)),
    }),
  );
}
