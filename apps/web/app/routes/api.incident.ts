import type { LoaderFunctionArgs } from 'react-router';
import { DomainError } from '@ghostshopper/domain';
import { jsonResponse, listQuery, monitoringRequest } from '../monitoring.server.js';
export function loader({ request, params }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) => {
    const incident = await service.getIncident(params.incidentId);
    if (!incident) throw new DomainError('NOT_FOUND');
    return jsonResponse({
      incident,
      occurrences: await service.listIncidentOccurrences(incident.id, listQuery(request)),
    });
  });
}
