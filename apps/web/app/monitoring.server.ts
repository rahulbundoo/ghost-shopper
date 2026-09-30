import { MonitoringService } from '@ghostshopper/application';
import { ValidationError } from '@ghostshopper/contracts';
import { createTenantRepositories } from '@ghostshopper/database';
import { DomainError } from '@ghostshopper/domain';
import { getRuntime, withShopifyBoundary } from './shopify.server.js';

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function monitoringRequest(
  request: Request,
  methods: readonly string[],
  operation: (service: MonitoringService) => Promise<Response>,
): Promise<Response> {
  try {
    return await withShopifyBoundary(async () => {
      // APIs require an App Bridge bearer token, not ambient browser cookies.
      if (!request.headers.get('Authorization')?.startsWith('Bearer ')) {
        return jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401);
      }
      const { shopify, db } = getRuntime();
      const { session } = await shopify.authenticate.admin(request);
      if (!methods.includes(request.method)) {
        return new Response(null, {
          status: 405,
          headers: { Allow: methods.join(', '), 'Cache-Control': 'no-store' },
        });
      }
      const service = new MonitoringService(createTenantRepositories(db, session.shop));
      try {
        return await operation(service);
      } catch (error) {
        if (error instanceof ValidationError)
          return jsonResponse({ error: { code: 'INVALID_INPUT', fields: error.fields } }, 400);
        if (error instanceof DomainError) {
          const status =
            error.code === 'NOT_FOUND' ? 404 : error.code === 'SHOP_INACTIVE' ? 403 : 409;
          return jsonResponse({ error: { code: error.code } }, status);
        }
        throw error;
      }
    });
  } catch (error) {
    if (!(error instanceof Response)) throw error;
    const headers = new Headers(error.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    // Preserve Shopify's authentication challenge and retry headers.
    return new Response(error.body, {
      status: error.status,
      statusText: error.statusText,
      headers,
    });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  if (
    request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    throw new ValidationError(['contentType']);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError(['body']);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw new ValidationError(['body']);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new ValidationError(['body']);
  } finally {
    reader.releaseLock();
  }
}

export function listQuery(request: Request): Record<string, unknown> {
  const entries = new URL(request.url).searchParams;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of entries) {
    if (Object.hasOwn(result, key)) throw new ValidationError(['query']);
    result[key] =
      (key === 'limit' || key === 'offset') && /^\d+$/.test(value) ? Number(value) : value;
  }
  return result;
}
