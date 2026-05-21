import { createHash } from 'node:crypto';
import type { Client } from '@libsql/client';

/**
 * Per-IP daily rate limit, backed by a single row in `rate_limits`.
 *
 * The IP itself is never persisted — only `sha256(ip + salt)`. Salt comes
 * from `RATE_LIMIT_SALT` env var; falls back to a constant (acceptable for
 * a single-tenant demo, but rotate if it ever leaks).
 *
 * Day boundary is UTC midnight. Counter resets implicitly when `day` changes
 * — no eviction job needed; old rows just sit there until manual cleanup.
 */

/** Default per-IP daily cap on *uploads* (sample browsing is free — it loads
 *  pre-baked results, no API call). Sized for a public demo: a genuine
 *  evaluator uploads a handful of documents, while a single IP can't run up
 *  unbounded model cost. Override per-environment with RATE_LIMIT_PER_DAY
 *  (e.g. a high value while actively testing). */
export const DAILY_LIMIT = 25;

function effectiveDailyLimit(): number {
  const fromEnv = Number(process.env.RATE_LIMIT_PER_DAY);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DAILY_LIMIT;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetsAtUtc: string; // ISO 8601, start of next UTC day
}

/**
 * Hash an IP into the stable bucket the table uses. Same IP → same bucket.
 */
export function bucketIp(ip: string): string {
  const salt = process.env.RATE_LIMIT_SALT ?? 'contract-lens-v0.1-default-salt';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function nextUtcMidnight(now: Date = new Date()): string {
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * Atomic check-and-increment in a single statement: insert the row at count=1,
 * or increment it only while still under the daily limit. When the row is
 * already at the limit the conditional `DO UPDATE` is a no-op, so `RETURNING`
 * yields no row and we signal denied without a write.
 *
 * Doing this as one `INSERT … ON CONFLICT DO UPDATE … WHERE count < N RETURNING`
 * statement is what makes it race-safe: a prior version did a separate
 * `SELECT` then `INSERT`, so two concurrent requests from one IP could both
 * read `count = N-1` and both increment, slipping past the cap — the exact
 * abuse case a public, paid endpoint must resist.
 */
export async function checkAndIncrement(
  client: Client,
  ipBucket: string,
  now: Date = new Date()
): Promise<RateLimitResult> {
  const day = todayUtc(now);
  const limit = effectiveDailyLimit();

  const result = await client.execute({
    sql: `INSERT INTO rate_limits (ip_bucket, day, count)
          VALUES (?, ?, 1)
          ON CONFLICT(ip_bucket, day) DO UPDATE SET count = count + 1
            WHERE count < ?
          RETURNING count`,
    args: [ipBucket, day, limit],
  });

  // No row returned → the conditional update was a no-op → already at the cap.
  if (result.rows.length === 0) {
    return { allowed: false, remaining: 0, resetsAtUtc: nextUtcMidnight(now) };
  }

  const count = Number(result.rows[0].count);
  return {
    allowed: true,
    remaining: Math.max(0, limit - count),
    resetsAtUtc: nextUtcMidnight(now),
  };
}
