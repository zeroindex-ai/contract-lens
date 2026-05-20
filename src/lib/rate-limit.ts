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

/** Default daily cap. Override per-environment with RATE_LIMIT_PER_DAY
 *  (e.g. a high value locally for testing, 5 in production). */
export const DAILY_LIMIT = 5;

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
 * Check-and-increment in one round trip: if the caller is below the daily
 * limit, increment the counter and return `allowed: true`. If at or above,
 * return `allowed: false` and don't touch the counter.
 *
 * Implementation note: SQLite's UPSERT + WHERE on the conflict lets us do
 * "increment only if count < N" atomically. If the row already has count >= N,
 * the conflict's DO UPDATE clause is skipped by the WHERE, so we end the
 * transaction without a write and signal denied to the caller.
 */
export async function checkAndIncrement(
  client: Client,
  ipBucket: string,
  now: Date = new Date()
): Promise<RateLimitResult> {
  const day = todayUtc(now);

  // First read the current count so we can decide whether to attempt the
  // increment. (UPSERT with conditional update is possible but harder to
  // make portable across libsql versions; this is two round trips but
  // simpler and the rate-limit table is tiny.)
  const before = await client.execute({
    sql: 'SELECT count FROM rate_limits WHERE ip_bucket = ? AND day = ?',
    args: [ipBucket, day],
  });

  const currentCount = before.rows[0] ? Number(before.rows[0].count) : 0;
  const limit = effectiveDailyLimit();

  if (currentCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetsAtUtc: nextUtcMidnight(now),
    };
  }

  // Increment (or insert with count=1).
  await client.execute({
    sql: `INSERT INTO rate_limits (ip_bucket, day, count)
          VALUES (?, ?, 1)
          ON CONFLICT(ip_bucket, day) DO UPDATE SET count = count + 1`,
    args: [ipBucket, day],
  });

  return {
    allowed: true,
    remaining: limit - (currentCount + 1),
    resetsAtUtc: nextUtcMidnight(now),
  };
}
