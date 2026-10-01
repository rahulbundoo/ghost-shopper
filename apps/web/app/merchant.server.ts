import { MonitoringService } from '@ghostshopper/application';
import { ValidationError } from '@ghostshopper/contracts';
import { createTenantRepositories } from '@ghostshopper/database';
import { DomainError } from '@ghostshopper/domain';
import { data } from 'react-router';
import { getRuntime, withShopifyBoundary } from './shopify.server.js';
import { enforceRateLimit } from './hardening.server.js';

/** Document/data loaders authenticate independently of the parent layout. */
export function merchantRead<T>(
  request: Request,
  read: (service: MonitoringService) => Promise<T>,
) {
  return withShopifyBoundary(async () => {
    const { shopify, db, billing } = getRuntime();
    const { session } = await shopify.authenticate.admin(request);
    await enforceRateLimit(db, session.shop, 'read', 120);
    try {
      return data(
        await read(
          new MonitoringService(
            billing
              ? createTenantRepositories(db, session.shop, billing)
              : createTenantRepositories(db, session.shop),
          ),
        ),
        {
          headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
        },
      );
    } catch (error) {
      if (error instanceof ValidationError) throw new Response('Invalid request', { status: 400 });
      if (error instanceof DomainError)
        throw new Response('Resource unavailable', {
          status: error.code === 'NOT_FOUND' ? 404 : error.code === 'SHOP_INACTIVE' ? 403 : 409,
        });
      throw error;
    }
  });
}

export const PAGE_SIZE = 25;
export function pageQuery(request: Request) {
  const query = new URL(request.url).searchParams;
  const raw = query.get('offset') ?? '0';
  if (query.getAll('offset').length > 1 || !/^\d+$/.test(raw) || Number(raw) > 99975)
    throw new ValidationError(['offset']);
  return { offset: Number(raw), limit: PAGE_SIZE + 1 };
}
export function incidentStatus(request: Request): 'OPEN' | 'RESOLVED' {
  const query = new URL(request.url).searchParams;
  const status = query.get('status') ?? 'OPEN';
  if (query.getAll('status').length > 1 || (status !== 'OPEN' && status !== 'RESOLVED'))
    throw new ValidationError(['status']);
  return status;
}
export function pageResult<T>(items: T[], offset: number) {
  return {
    items: items.slice(0, PAGE_SIZE),
    offset,
    hasNext: items.length > PAGE_SIZE && offset < 99975,
  };
}
export function required<T>(value: T | null): T {
  if (value === null) throw new DomainError('NOT_FOUND');
  return value;
}
