import { describe, expect, it, vi } from 'vitest';
import {
  fetchShopProfile,
  ShopifyConnectionError,
  type ShopGraphqlClient,
} from '../../packages/shopify/src/shop-profile.js';

const profile = {
  id: 'gid://shopify/Shop/123',
  name: 'Demo Shop',
  myshopifyDomain: 'demo.myshopify.com',
  currencyCode: 'USD',
  primaryDomain: { url: 'https://demo.example' },
};
describe('authenticated GraphQL shop identity', () => {
  it('queries shop identity with a bounded request and validates the response', async () => {
    const graphql = vi
      .fn<ShopGraphqlClient>()
      .mockResolvedValue(Response.json({ data: { shop: profile } }));
    expect(await fetchShopProfile('demo.myshopify.com', graphql)).toEqual(profile);
    expect(graphql.mock.calls[0]?.[0]).toContain('query GhostShopperShopIdentity');
    expect(graphql.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(graphql.mock.calls[0]?.[0]).not.toContain('mutation');
  });
  it('rejects cross-tenant identity, even when the provider responds successfully', async () => {
    const graphql = vi.fn().mockResolvedValue(Response.json({ data: { shop: profile } }));
    await expect(fetchShopProfile('other.myshopify.com', graphql)).rejects.toMatchObject({
      code: 'SHOP_IDENTITY_MISMATCH',
    });
  });
  it.each([
    { data: { shop: null } },
    { data: { shop: profile }, errors: [{ message: 'sensitive provider error' }] },
    { data: { shop: { ...profile, primaryDomain: { url: 'javascript:alert(1)' } } } },
  ])('rejects invalid or partial GraphQL output', async (body) => {
    await expect(
      fetchShopProfile('demo.myshopify.com', () => Promise.resolve(Response.json(body))),
    ).rejects.toMatchObject({ code: 'SHOPIFY_INVALID_RESPONSE' });
  });
  it('does not expose provider exception details', async () => {
    const graphql = vi.fn().mockRejectedValue(new Error('secret access token'));
    const result = fetchShopProfile('demo.myshopify.com', graphql);
    await expect(result).rejects.toBeInstanceOf(ShopifyConnectionError);
    await expect(result).rejects.not.toThrow('secret access token');
  });
  it('rejects HTTP and invalid JSON failures', async () => {
    await expect(
      fetchShopProfile('demo.myshopify.com', () =>
        Promise.resolve(new Response('', { status: 500 })),
      ),
    ).rejects.toMatchObject({ code: 'SHOPIFY_GRAPHQL_FAILED' });
    await expect(
      fetchShopProfile('demo.myshopify.com', () => Promise.resolve(new Response('not json'))),
    ).rejects.toMatchObject({ code: 'SHOPIFY_INVALID_RESPONSE' });
  });
});
