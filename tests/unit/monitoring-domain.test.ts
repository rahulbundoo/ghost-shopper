import { describe, expect, it } from 'vitest';
import {
  assertShopActive,
  DomainError,
  snapshotMonitor,
  type Monitor,
  type Shop,
} from '../../packages/domain/src/index.js';
import {
  createMonitorSchema,
  createTestRunSchema,
  paginationSchema,
  updateMonitorSchema,
  validate,
  ValidationError,
} from '../../packages/contracts/src/index.js';

const shop: Shop = {
  id: 'demo.myshopify.com',
  shopifyId: null,
  name: null,
  storefrontUrl: null,
  currencyCode: null,
  installedAt: new Date(),
  uninstalledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const input = { name: ' Main product ', productId: 'gid://shopify/Product/123', device: 'DESKTOP' };
describe('domain and monitoring validation', () => {
  it('accepts installed shops', () => expect(() => assertShopActive(shop)).not.toThrow());
  it.each([null, { ...shop, installedAt: null }, { ...shop, uninstalledAt: new Date() }])(
    'rejects inactive shops',
    (value) => {
      expect(() => assertShopActive(value)).toThrow(DomainError);
    },
  );
  it('normalizes a monitor with explicit defaults', () => {
    expect(validate(createMonitorSchema, input)).toEqual({
      ...input,
      name: 'Main product',
      scenario: 'PURCHASE_JOURNEY',
      frequency: 'DAILY',
      variantId: null,
      enabled: true,
    });
  });
  it.each([
    { name: '' },
    { name: 'x'.repeat(121) },
    { productId: 'http://127.0.0.1' },
    { productId: 'gid://shopify/Product/0' },
    { variantId: 'gid://shopify/Product/1' },
    { device: 'TABLET' },
    { frequency: '*/5 * * * *' },
    { scenario: 'PAYMENT' },
    { shopId: 'other.myshopify.com' },
    { id: 'client-id' },
    { enabled: 'false' },
    { version: 5 },
  ])('rejects invalid or caller-owned fields: %j', (change) => {
    expect(() => validate(createMonitorSchema, { ...input, ...change })).toThrow(ValidationError);
  });
  it.each([
    { version: 1 },
    { name: 'missing version' },
    { version: 0, enabled: false },
    { version: 1, name: undefined },
    { version: 1, shopId: shop.id },
  ])('rejects invalid updates: %j', (change) => {
    expect(() => validate(updateMonitorSchema, change)).toThrow(ValidationError);
  });
  it('allows explicit disable and variant clearing', () => {
    expect(validate(updateMonitorSchema, { version: 1, enabled: false, variantId: null })).toEqual({
      version: 1,
      enabled: false,
      variantId: null,
    });
  });
  it.each([
    { limit: 101 },
    { offset: -1 },
    { limit: 1.5 },
    { offset: 100001 },
    { shopId: shop.id },
  ])('bounds pagination: %j', (value) => {
    expect(() => validate(paginationSchema, value)).toThrow(ValidationError);
  });
  it('disallows caller-supplied run state and tenant', () => {
    const monitorId = 'ce42d97b-795d-42f8-b126-62b00d7c18dd';
    expect(validate(createTestRunSchema, { monitorId })).toEqual({ monitorId });
    expect(() => validate(createTestRunSchema, { monitorId, status: 'COMPLETED' })).toThrow(
      ValidationError,
    );
    expect(() => validate(createTestRunSchema, { monitorId, shopId: shop.id })).toThrow(
      ValidationError,
    );
  });
  it('snapshots configuration without mutable monitor metadata', () => {
    const monitor: Monitor = {
      ...validate(createMonitorSchema, input),
      id: 'id',
      shopId: shop.id,
      version: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const snapshot = snapshotMonitor(monitor);
    expect(snapshot).toEqual({
      scenario: 'PURCHASE_JOURNEY',
      productId: input.productId,
      variantId: null,
      device: 'DESKTOP',
      monitorVersion: 3,
    });
    expect(
      snapshotMonitor({ ...monitor, productId: 'gid://shopify/Product/456' }).productId,
    ).not.toBe(snapshot.productId);
    expect(() => snapshotMonitor({ ...monitor, enabled: false })).toThrow('MONITOR_DISABLED');
  });
});
