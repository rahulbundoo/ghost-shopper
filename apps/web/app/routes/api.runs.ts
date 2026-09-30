import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { jsonResponse, listQuery, monitoringRequest, readJson } from '../monitoring.server';
import { enqueueCreatedRun } from '../dispatch.server';
export function loader({ request }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) =>
    jsonResponse({ runs: await service.listTestRuns(listQuery(request)) }),
  );
}
export function action({ request }: ActionFunctionArgs) {
  return monitoringRequest(request, ['POST'], async (service) => {
    const run = await service.createTestRun(await readJson(request));
    return jsonResponse({ run, dispatch: await enqueueCreatedRun(run) }, 202);
  });
}
