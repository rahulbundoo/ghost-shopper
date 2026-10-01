import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { billingRequest } from '../billing.server.js';
export function loader({ request }: LoaderFunctionArgs) {
  return billingRequest(request, true);
}
export function action({ request }: ActionFunctionArgs) {
  return billingRequest(request, true);
}
