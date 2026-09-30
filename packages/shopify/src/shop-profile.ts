import { shopDomainSchema, shopQueryResultSchema, type ShopProfile } from '@ghostshopper/contracts';

export const SHOP_QUERY = `#graphql
  query GhostShopperShopIdentity {
    shop { id name myshopifyDomain currencyCode primaryDomain { url } }
  }
`;
export type ShopGraphqlClient = (
  query: string,
  options: { signal: AbortSignal },
) => Promise<Response>;

export class ShopifyConnectionError extends Error {
  constructor(
    readonly code: 'SHOPIFY_GRAPHQL_FAILED' | 'SHOPIFY_INVALID_RESPONSE' | 'SHOP_IDENTITY_MISMATCH',
  ) {
    super('Unable to verify the Shopify connection. Please try again.');
    this.name = 'ShopifyConnectionError';
  }
}
export async function fetchShopProfile(
  authenticatedShop: string,
  graphql: ShopGraphqlClient,
): Promise<ShopProfile> {
  const tenant = shopDomainSchema.parse(authenticatedShop);
  let response: Response;
  try {
    response = await graphql(SHOP_QUERY, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ShopifyConnectionError('SHOPIFY_GRAPHQL_FAILED');
  }
  if (!response.ok) throw new ShopifyConnectionError('SHOPIFY_GRAPHQL_FAILED');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ShopifyConnectionError('SHOPIFY_INVALID_RESPONSE');
  }
  const result = shopQueryResultSchema.safeParse(body);
  if (!result.success || result.data.errors?.length) {
    throw new ShopifyConnectionError('SHOPIFY_INVALID_RESPONSE');
  }
  if (result.data.data.shop.myshopifyDomain !== tenant) {
    throw new ShopifyConnectionError('SHOP_IDENTITY_MISMATCH');
  }
  return result.data.data.shop;
}
