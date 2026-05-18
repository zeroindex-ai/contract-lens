import type { Client } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Apply every `.sql` file under src/db/migrations/ in filename order.
 *
 * Used by tests (against an in-memory client) and by `pnpm tsx scripts/migrate.ts`
 * for the real Turso DB. There's no migration tracking table in v0.1 — each
 * file uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so
 * re-running is a no-op.
 */
export async function applyMigrations(client: Client): Promise<void> {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8');
    // libsql doesn't accept multi-statement strings in a single execute call.
    // 1) strip `--` line comments so they don't poison statement-splitting
    // 2) split on `;` followed by whitespace, drop empties
    const stripped = raw
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = stripped
      .split(/;\s*\n/)
      .map((s) => s.trim().replace(/;\s*$/, ''))
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await client.execute(stmt);
    }
  }
}
