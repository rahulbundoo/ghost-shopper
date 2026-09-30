import type { LoaderFunctionArgs } from 'react-router';
import { DomainError } from '@ghostshopper/domain';
import { jsonResponse, monitoringRequest } from '../monitoring.server.js';
import { artifactDownload } from '../artifacts.server.js';
export function loader({ request, params }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) => {
    const artifact = await service.getArtifact(params.artifactId);
    if (!artifact) throw new DomainError('NOT_FOUND');
    // Authorization precedes signing; no request may supply a bucket or object key.
    const response = jsonResponse(await artifactDownload(artifact));
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  });
}
