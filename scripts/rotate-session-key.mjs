import { createDatabase } from '../packages/database/dist/index.js';
import { TokenCipher } from '../packages/shopify/dist/token-cipher.js';
// Stop web/runner writers and take an encrypted backup before applying. Never prints token data.
const db = createDatabase(process.env.DATABASE_URL ?? '');
try {
  const current = new TokenCipher(process.env.SESSION_ENCRYPTION_KEY ?? '');
  const previous = process.env.PREVIOUS_SESSION_ENCRYPTION_KEY
    ? new TokenCipher(process.env.PREVIOUS_SESSION_ENCRYPTION_KEY)
    : null;
  let cursor;
  let count = 0;
  while (true) {
    const rows = await db.session.findMany({
      take: 100,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      const transform = (value, kind) => {
        if (!value) return value;
        const binding = `${row.id}:${kind}`;
        if (value.startsWith('enc:')) {
          try {
            current.decrypt(value, binding);
            return value;
          } catch {
            /* Try the old key, if supplied. */
          }
          if (!previous) throw new Error('PREVIOUS_KEY_REQUIRED');
          value = previous.decrypt(value, binding);
        }
        return current.encrypt(value, binding);
      };
      const accessToken = transform(row.accessToken, 'access');
      const refreshToken = transform(row.refreshToken, 'refresh');
      if (process.argv.includes('--apply')) {
        const updated = await db.session.updateMany({
          where: { id: row.id, accessToken: row.accessToken, refreshToken: row.refreshToken },
          data: { accessToken, refreshToken },
        });
        if (updated.count !== 1) throw new Error('CONCURRENT_SESSION_CHANGE');
      }
      count++;
    }
    cursor = rows.at(-1).id;
  }
  console.info(
    JSON.stringify({
      event: process.argv.includes('--apply')
        ? 'session.rotation.applied'
        : 'session.rotation.checked',
      count,
    }),
  );
} catch {
  console.error(
    'Session key check/rotation failed. Keep the previous key and backup; no token data logged.',
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
