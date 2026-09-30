import { resolve4 } from 'node:dns/promises';
import { createServer } from 'node:http';
import { createConnection, isIPv4, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';

export function isPublicIPv4(address: string): boolean {
  if (!isIPv4(address)) return false;
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function storefrontOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)
  )
    throw new Error('UNSAFE_STOREFRONT');
  return url.origin;
}
export function safeResultUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (/\/checkouts?(?:\/|$)/i.test(url.pathname)) return `${url.origin}/checkout`;
    // Persist only known storefront routes, not arbitrary page-provided paths/tokens.
    const path = url.pathname.match(
      /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:products\/[a-z0-9-]+|collections\/[a-z0-9-]+|cart|password)?\/?$/i,
    );
    return path ? `${url.origin}${url.pathname}` : url.origin;
  } catch {
    return null;
  }
}

/** Local CONNECT proxy: DNS is resolved and checked BEFORE dialing a numeric IP.
 * Chromium cannot re-resolve a checked hostname (DNS rebinding). No HTTP, arbitrary
 * ports, IP literals, private networks or non-allowlisted hosts are reachable.
 */
export async function startEgressProxy(hosts: ReadonlySet<string>) {
  const password = randomBytes(24).toString('hex');
  const authorization = `Basic ${Buffer.from(`runner:${password}`).toString('base64')}`;
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    response.writeHead(403).end();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  });
  server.on('connect', (request, socket, head) => {
    if (request.headers['proxy-authorization'] !== authorization) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="runner"\r\n\r\n',
      );
      return;
    }
    const match = /^([a-z0-9.-]+):443$/i.exec(request.url ?? '');
    const host = match?.[1]?.toLowerCase();
    if (!host || !hosts.has(host)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const deadline = setTimeout(() => socket.destroy(), 10_000);
    void resolve4(host)
      .then((addresses) => {
        if (socket.destroyed) return;
        if (!addresses.length || !addresses.every(isPublicIPv4)) throw new Error('UNSAFE_ADDRESS');
        const upstream = createConnection({ host: addresses[0]!, port: 443 });
        sockets.add(upstream);
        upstream.on('close', () => sockets.delete(upstream));
        upstream.on('error', () => {
          clearTimeout(deadline);
          socket.destroy();
        });
        socket.on('close', () => {
          clearTimeout(deadline);
          upstream.destroy();
        });
        upstream.once('connect', () => {
          clearTimeout(deadline);
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          socket.pipe(upstream).pipe(socket);
        });
      })
      .catch(() => {
        clearTimeout(deadline);
        socket.destroy();
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('PROXY_START_FAILED');
  return {
    settings: { server: `http://127.0.0.1:${address.port}`, username: 'runner', password },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
