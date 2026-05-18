import { describe, expect, it, beforeEach } from 'vitest';
import { inMemoryClient } from '@/db/client';
import { applyMigrations } from '@/db/schema';
import { bucketIp, checkAndIncrement, DAILY_LIMIT } from './rate-limit';
import type { Client } from '@libsql/client';

describe('bucketIp', () => {
  it('produces a 64-char hex digest', () => {
    expect(bucketIp('1.2.3.4')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same IP', () => {
    expect(bucketIp('1.2.3.4')).toBe(bucketIp('1.2.3.4'));
  });

  it('produces different buckets for different IPs', () => {
    expect(bucketIp('1.2.3.4')).not.toBe(bucketIp('5.6.7.8'));
  });
});

describe('checkAndIncrement', () => {
  let client: Client;

  beforeEach(async () => {
    client = inMemoryClient();
    await applyMigrations(client);
  });

  it('allows the first call from a new IP', async () => {
    const result = await checkAndIncrement(client, bucketIp('1.2.3.4'));
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(DAILY_LIMIT - 1);
  });

  it('allows up to DAILY_LIMIT calls then denies the next', async () => {
    const bucket = bucketIp('1.2.3.4');
    for (let i = 0; i < DAILY_LIMIT; i++) {
      const r = await checkAndIncrement(client, bucket);
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(DAILY_LIMIT - 1 - i);
    }
    const denied = await checkAndIncrement(client, bucket);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('does not increment the counter when denied', async () => {
    const bucket = bucketIp('1.2.3.4');
    for (let i = 0; i < DAILY_LIMIT; i++) {
      await checkAndIncrement(client, bucket);
    }
    await checkAndIncrement(client, bucket); // denied
    await checkAndIncrement(client, bucket); // also denied

    const row = await client.execute({
      sql: 'SELECT count FROM rate_limits WHERE ip_bucket = ?',
      args: [bucket],
    });
    expect(Number(row.rows[0].count)).toBe(DAILY_LIMIT);
  });

  it('tracks IPs independently', async () => {
    const a = bucketIp('1.1.1.1');
    const b = bucketIp('2.2.2.2');
    for (let i = 0; i < DAILY_LIMIT; i++) {
      await checkAndIncrement(client, a);
    }
    const aDenied = await checkAndIncrement(client, a);
    const bAllowed = await checkAndIncrement(client, b);
    expect(aDenied.allowed).toBe(false);
    expect(bAllowed.allowed).toBe(true);
  });

  it('resets across a UTC day boundary (separate rows per day)', async () => {
    const bucket = bucketIp('1.2.3.4');
    const monday = new Date('2026-05-18T12:00:00.000Z');
    const tuesday = new Date('2026-05-19T12:00:00.000Z');

    for (let i = 0; i < DAILY_LIMIT; i++) {
      await checkAndIncrement(client, bucket, monday);
    }
    const mondayDenied = await checkAndIncrement(client, bucket, monday);
    expect(mondayDenied.allowed).toBe(false);

    const tuesdayAllowed = await checkAndIncrement(client, bucket, tuesday);
    expect(tuesdayAllowed.allowed).toBe(true);
    expect(tuesdayAllowed.remaining).toBe(DAILY_LIMIT - 1);
  });

  it('returns next-UTC-midnight as the reset time', async () => {
    const bucket = bucketIp('1.2.3.4');
    const result = await checkAndIncrement(client, bucket, new Date('2026-05-18T15:30:00.000Z'));
    expect(result.resetsAtUtc).toBe('2026-05-19T00:00:00.000Z');
  });
});
