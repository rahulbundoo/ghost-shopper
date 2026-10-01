import { BillingService } from '@ghostshopper/application';
import { PrismaBillingRepository } from '@ghostshopper/database';
import { ShopifyBillingProvider } from '@ghostshopper/shopify';
import { DomainError } from '@ghostshopper/domain';
import { billingActionSchema, validate, ValidationError } from '@ghostshopper/contracts';
import { getRuntime, withShopifyBoundary } from './shopify.server.js';
import { jsonResponse, readJson } from './monitoring.server.js';
import { enforceRateLimit } from './hardening.server.js';

export function billingRequest(request: Request, api = false): Promise<Response> {
  return withShopifyBoundary(async () => {
    if (api && !request.headers.get('Authorization')?.startsWith('Bearer '))
      return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401);
    const { shopify, db, config, billing } = getRuntime();
    const { session, admin } = await shopify.authenticate.admin(request);
    await enforceRateLimit(
      db,
      session.shop,
      request.method === 'GET' ? 'billing-read' : 'billing-write',
      request.method === 'GET' ? 10 : 5,
    );
    if ((!api && request.method !== 'GET') || (api && !['GET', 'POST'].includes(request.method)))
      return new Response(null, {
        status: 405,
        headers: { Allow: api ? 'GET, POST' : 'GET', 'Cache-Control': 'no-store' },
      });
    if (!billing) return jsonResponse({ enabled: false }, request.method === 'POST' ? 503 : 200);
    const repository = new PrismaBillingRepository(db, session.shop, billing);
    const service = new BillingService(
      repository,
      new ShopifyBillingProvider(session.shop, admin.graphql, billing, config.appUrl),
    );
    try {
      if (request.method === 'POST') {
        const input = validate(billingActionSchema, await readJson(request));
        if (input.action === 'checkout')
          return jsonResponse({ confirmationUrl: await service.checkout() });
        if (input.action === 'cancel') await service.cancel();
        else await service.refresh();
        return jsonResponse({
          enabled: true,
          summary: await repository.summary(),
          syncFailed: false,
        });
      }
      // Callback query parameters (including charge_id) never determine entitlement.
      let syncFailed = false;
      try {
        await service.refresh();
      } catch {
        syncFailed = true;
      }
      return jsonResponse({ enabled: true, summary: await repository.summary(), syncFailed });
    } catch (error) {
      if (error instanceof ValidationError)
        return jsonResponse({ error: { code: 'INVALID_INPUT' } }, 400);
      if (error instanceof DomainError)
        return jsonResponse(
          { error: { code: error.code } },
          error.code === 'SHOP_INACTIVE' ? 403 : 409,
        );
      throw error;
    }
  });
}
