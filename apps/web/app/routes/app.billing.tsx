import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { billingRequest } from '../billing.server';
import { BillingView, type BillingViewData } from '../components/billing';
export function loader({ request }: LoaderFunctionArgs) {
  return billingRequest(request);
}
export default function BillingPage() {
  return <BillingView {...useLoaderData<BillingViewData>()} />;
}
export { PageError as ErrorBoundary } from '../components/merchant';
