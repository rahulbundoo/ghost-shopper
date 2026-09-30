import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  isShopifyConfigured,
  readShopifyConfig,
  SHOPIFY_SCOPES,
} from '../../packages/config/src/index.js';
import { shopDomainSchema } from '../../packages/contracts/src/index.js';

const environment = {
  SHOPIFY_API_KEY: 'test-client-id',
  SHOPIFY_API_SECRET: 'test-secret',
  SHOPIFY_APP_URL: 'https://ghostshopper.example',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
};
describe('Shopify configuration and tenant identifiers', () => {
  it('accepts configured PostgreSQL/HTTPS origins without requesting unnecessary scopes', () => {
    expect(readShopifyConfig(environment).appUrl).toBe(environment.SHOPIFY_APP_URL);
    expect(SHOPIFY_SCOPES).toEqual([]);
  });
  it.each([
    'http://shop.example',
    'https://user:secret@shop.example',
    'https://shop.example/app',
    'https://example.invalid',
  ])('rejects unsafe or placeholder app origin %s', (url) => {
    expect(isShopifyConfigured({ ...environment, SHOPIFY_APP_URL: url })).toBe(false);
  });
  it('rejects missing configuration without exposing input secrets', () => {
    try {
      readShopifyConfig({ ...environment, DATABASE_URL: 'secret-value' });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).not.toContain('secret-value');
      expect(error).toMatchObject({ fields: ['DATABASE_URL'] });
      return;
    }
    throw new Error('Expected configuration rejection');
  });
  it.each([
    'localhost',
    'shop.example',
    'shop.myshopify.com.attacker.example',
    'https://shop.myshopify.com',
    '../shop',
    'shop.myshopify.com:443',
  ])('rejects noncanonical tenant identifier %s', (shop) => {
    expect(shopDomainSchema.safeParse(shop).success).toBe(false);
  });
  it('normalizes a valid Shopify domain', () => {
    expect(shopDomainSchema.parse(' Demo-Shop.myshopify.com ')).toBe('demo-shop.myshopify.com');
  });
});
