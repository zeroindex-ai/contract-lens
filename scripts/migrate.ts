/**
 * Apply pending SQL migrations to the configured Turso database.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/migrate.ts
 */

import { db } from '../src/db/client';
import { applyMigrations } from '../src/db/schema';

async function main() {
  const client = db();
  await applyMigrations(client);
  console.log('Migrations applied successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
