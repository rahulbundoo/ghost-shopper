import { timingSafeEqual } from 'node:crypto';
import { PrismaRateLimiter } from '@ghostshopper/database';
import type { PrismaClient } from '@ghostshopper/database';
export async function enforceRateLimit(
  db: PrismaClient,
  shop: string,
  group: string,
  limit: number,
) {
  if (!(await new PrismaRateLimiter(db).take(shop, group, limit)))
    throw new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': '60',
      },
    });
}
export function readinessAuthorized(request: Request, token: string | undefined) {
  if (!token) return false;
  const value = request.headers.get('Authorization') ?? '';
  const expected = `Bearer ${token}`;
  const actualBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
