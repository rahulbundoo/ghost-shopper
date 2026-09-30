import {
  Form,
  useActionData,
  useLoaderData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from 'react-router';
import { getRuntime, withShopifyBoundary } from '../shopify.server';

export async function loader({ request }: LoaderFunctionArgs) {
  return withShopifyBoundary(async () => ({ errors: await getRuntime().shopify.login(request) }));
}
export async function action({ request }: ActionFunctionArgs) {
  return withShopifyBoundary(async () => ({ errors: await getRuntime().shopify.login(request) }));
}
export default function Login() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  const error = (submitted ?? loaded).errors.shop;
  return (
    <main className="landing">
      <p className="eyebrow">GHOSTSHOPPER</p>
      <h1>Connect your store</h1>
      <p>Use your store’s myshopify.com address to continue securely through Shopify.</p>
      <Form method="post" className="login-form">
        <label htmlFor="shop">Shop domain</label>
        <input
          id="shop"
          name="shop"
          type="text"
          placeholder="your-store.myshopify.com"
          autoComplete="url"
          required
          aria-describedby={error ? 'shop-error' : 'shop-help'}
        />
        <p id="shop-help">For example: your-store.myshopify.com</p>
        {error ? (
          <p id="shop-error" role="alert">
            Enter a valid myshopify.com shop domain.
          </p>
        ) : null}
        <button className="button" type="submit">
          Continue to Shopify
        </button>
      </Form>
    </main>
  );
}
