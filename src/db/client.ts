import { createClient, type Client } from '@libsql/client';

/**
 * Singleton libsql client. URL + auth token come from env at first call.
 *
 * `TURSO_DATABASE_URL` accepts hosted Turso URLs (`libsql://...`) and local
 * file URLs (`file:./local.db`) for dev. `:memory:` is also supported for
 * tests; in that case `db()` should be called fresh per test (don't share
 * the singleton).
 */

let client: Client | null = null;

export function db(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set');
  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return client;
}

/**
 * Build a fresh in-memory client. For tests only — never call from app code.
 */
export function inMemoryClient(): Client {
  return createClient({ url: ':memory:' });
}

/**
 * Reset the singleton (for tests that need to swap env vars between cases).
 */
export function _resetDbForTests(): void {
  client = null;
}
