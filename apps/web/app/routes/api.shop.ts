import type { LoaderFunctionArgs } from 'react-router';
import { jsonResponse, monitoringRequest } from '../monitoring.server';
export function loader({ request }: LoaderFunctionArgs) {
  return monitoringRequest(request, ['GET'], async (service) =>
    jsonResponse({ shop: await service.getShop() }),
  );
}
