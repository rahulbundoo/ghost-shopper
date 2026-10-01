import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { jsonResponse, monitoringRequest, readJson } from '../monitoring.server.js';
export function loader({ request }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) =>
    jsonResponse({
      settings: await service.getNotificationSettings(),
      history: await service.listEmailHistory(),
    }),
  );
}
export function action({ request }: ActionFunctionArgs) {
  return monitoringRequest(request, ['PATCH'], async (service) =>
    jsonResponse({ settings: await service.updateNotificationSettings(await readJson(request)) }),
  );
}
