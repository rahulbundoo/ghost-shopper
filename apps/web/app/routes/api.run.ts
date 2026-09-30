import type { LoaderFunctionArgs } from 'react-router';
import { DomainError } from '@ghostshopper/domain';
import { jsonResponse, monitoringRequest } from '../monitoring.server.js';
export function loader({ request, params }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) => {
    const run = await service.getTestRun(params.runId);
    if (!run) throw new DomainError('NOT_FOUND');
    return jsonResponse({
      run,
      steps: await service.listRunSteps(run.id),
      artifacts: await service.listArtifacts(run.id),
      analyses: await service.listRunAnalyses(run.id),
      aiAnalyses: await service.listAiAnalyses(run.id),
    });
  });
}
