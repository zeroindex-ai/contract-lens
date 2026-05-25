import type { Client } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Split a SQL script into individual statements.
 *
 * libsql doesn't accept multi-statement strings in a single `execute` call, so
 * each migration file has to be split on statement boundaries. A naive split on
 * `;` breaks the moment a semicolon appears inside a string literal or inside a
 * `BEGIN ... END` trigger body, so this is a small character-level scanner that
 * only treats a `;` as a boundary when it's in "top-level" SQL — i.e. not:
 *   - inside a single- or double-quoted string (with `''` / `""` escaping)
 *   - inside a `--` line comment
 *   - inside a slash-star block comment
 *   - inside a `BEGIN ... END` body (CREATE TRIGGER, etc.)
 *
 * It's intentionally proportionate: enough to be correct for SQLite/libsql DDL,
 * not a full SQL parser.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let beginDepth = 0; // nesting of BEGIN...END blocks
  let i = 0;
  const n = sql.length;

  /** Read an identifier-ish word starting at `pos` (letters only). */
  const wordAt = (pos: number): string => {
    let j = pos;
    while (j < n && /[A-Za-z]/.test(sql[j] as string)) j++;
    return sql.slice(pos, j);
  };
  /** A keyword boundary requires a non-word char (or string edge) on both sides. */
  const isWordBoundary = (pos: number): boolean =>
    pos < 0 || pos >= n || !/[A-Za-z0-9_]/.test(sql[pos] as string);

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // ── comments ──
    if (ch === '-' && next === '-') {
      // line comment: skip to end of line, keep the newline
      const eol = sql.indexOf('\n', i);
      if (eol === -1) {
        i = n;
      } else {
        current += '\n';
        i = eol + 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      current += ' ';
      continue;
    }

    // ── string literals ──
    if (ch === "'" || ch === '"') {
      const quote = ch;
      current += ch;
      i++;
      while (i < n) {
        current += sql[i];
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            // doubled quote = escaped quote inside the literal
            current += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // ── BEGIN / END tracking (case-insensitive, word-bounded) ──
    if (ch === 'b' || ch === 'B' || ch === 'e' || ch === 'E') {
      if (isWordBoundary(i - 1)) {
        const word = wordAt(i).toUpperCase();
        if (word === 'BEGIN') {
          beginDepth++;
          current += sql.slice(i, i + word.length);
          i += word.length;
          continue;
        }
        if (word === 'END') {
          if (beginDepth > 0) beginDepth--;
          current += sql.slice(i, i + word.length);
          i += word.length;
          continue;
        }
      }
    }

    // ── statement boundary ──
    if (ch === ';' && beginDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

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
    for (const stmt of splitSqlStatements(raw)) {
      await client.execute(stmt);
    }
  }
}
