/** Canonical admin date format across ZeroIndex services (matches trace-pack /
 *  intake-zero): `YYYY-MM-DD HH:MM` — no seconds, no "UTC" label, space
 *  separator. ISO strings are already UTC; truncating at index 16 drops the
 *  seconds + tz suffix. Accepts a unix-seconds number or an ISO string. */
export function fmtTs(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const iso = typeof value === 'number' ? new Date(value * 1000).toISOString() : value;
  return iso.slice(0, 16).replace('T', ' ');
}
