/**
 * Extract the client IP from a Vercel-style request. In Vercel functions
 * the real client IP is in `x-forwarded-for` (comma-separated, first entry
 * is the original client) or `x-real-ip`. Local dev falls back to '127.0.0.1'.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
}
