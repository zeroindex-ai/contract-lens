/**
 * Extract the client IP from a Vercel-style request. In Vercel functions
 * the real client IP is in `x-forwarded-for` (comma-separated, first entry
 * is the original client) or `x-real-ip`. Local dev falls back to '127.0.0.1'.
 */
export function clientIp(headers: Headers): string {
  // Trust assumption: on Vercel the platform sets x-forwarded-for, so the first
  // entry is the real client. A spoofed XFF would reset the per-IP rate-limit
  // cap, which is acceptable for this public demo (Vercel overwrites it at the
  // edge); revisit if this ever runs behind a proxy that forwards client XFF.
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  if (first) return first;
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
}
