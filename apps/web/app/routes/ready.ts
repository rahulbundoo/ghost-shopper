import type { LoaderFunctionArgs } from 'react-router';
import { getRuntime } from '../shopify.server.js';
import { readinessAuthorized } from '../hardening.server.js';
export async function loader({ request }: LoaderFunctionArgs) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!readinessAuthorized(request, process.env['READINESS_TOKEN']))
    return new Response(null, { status: 404, headers });
  try {
    const { db } = getRuntime();
    const result = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        return tx.serviceHeartbeat.findFirst({
          where: { updatedAt: { gt: new Date(Date.now() - 180000) } },
        });
      },
      { timeout: 3000, maxWait: 1000 },
    );
    return Response.json(
      { status: result ? 'ready' : 'unavailable' },
      { status: result ? 200 : 503, headers },
    );
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers });
  }
}
