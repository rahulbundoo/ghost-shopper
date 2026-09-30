import type { Request, Route } from 'playwright';

export interface ResponseData {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}
export type FixtureTransport = (request: Request) => Promise<ResponseData>;

/** Redirects must not be handed to Chromium: Playwright will not re-route their
 * subsequent hops. Read each response without following, validate, then trigger a
 * fresh document GET. Non-document and method-preserving redirects fail closed.
 */
export async function respondSafely(
  route: Route,
  allowedOrigin: string,
  checkoutStarted: boolean,
  fixtureTransport?: FixtureTransport,
): Promise<void> {
  const request = route.request();
  const response = fixtureTransport ? await fixtureTransport(request) : await fetchResponse(route);
  const location = response.headers['location'];
  if (response.status >= 300 && response.status < 400 && location) {
    const target = new URL(location, request.url());
    const safe =
      request.isNavigationRequest() &&
      target.origin === allowedOrigin &&
      !target.username &&
      !target.password &&
      (request.method() === 'GET' || [301, 302, 303].includes(response.status)) &&
      (!/\/checkouts?(?:\/|$)/i.test(target.pathname) || checkoutStarted);
    if (!safe) {
      await route.abort('blockedbyclient');
      return;
    }
    const escaped = target.href
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;');
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<meta http-equiv="refresh" content="0;url=${escaped}">`,
    });
    return;
  }
  // Confirm that the checkout document responds, but never execute its scripts or
  // render actionable payment controls. The last journey step ends here.
  if (request.isNavigationRequest() && /\/checkouts\/[^/]+/.test(new URL(request.url()).pathname)) {
    await route.fulfill({
      status: response.status,
      contentType: 'text/html',
      body: '<!doctype html><title>Checkout initiated</title>',
    });
    return;
  }
  await route.fulfill(response);
}
async function fetchResponse(route: Route): Promise<ResponseData> {
  const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 10_000 });
  try {
    const body = await response.body();
    if (body.length > 10_000_000) throw new Error('RESPONSE_TOO_LARGE');
    const headers = response.headers();
    // APIResponse.body is decoded; do not advertise the upstream compression.
    delete headers['content-encoding'];
    delete headers['content-length'];
    return { status: response.status(), headers, body };
  } finally {
    await response.dispose();
  }
}
