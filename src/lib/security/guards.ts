/**
 * Request-level security helpers shared by API routes.
 *
 * These are deliberately small and dependency-free so they can be unit tested:
 * a rate limiter that fails closed, a same-origin guard for state-changing
 * requests, and a constant-time string comparison for tokens and codes.
 */

import { createHash, timingSafeEqual } from 'crypto';

/**
 * Compare two strings without leaking their length or content through timing.
 *
 * Both inputs are hashed to a fixed length before comparison so differing
 * lengths do not short-circuit, and `timingSafeEqual` compares the digests.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a, 'utf8').digest();
  const hashB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(hashA, hashB);
}

export interface RateLimitState {
  windowStart: number;
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Fixed-window rate limiter.
 *
 * The window is keyed by caller and advanced only when the clock passes it, so
 * a burst cannot reset the counter. The limit and window must both be positive;
 * a misconfiguration refuses the request rather than allowing it.
 */
export function checkRateLimit(
  state: RateLimitState | null,
  limit: number,
  windowMs: number,
  now: number,
): { result: RateLimitResult; state: RateLimitState } {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
    return {
      result: { allowed: false, remaining: 0, retryAfterMs: windowMs > 0 ? windowMs : 1000 },
      state: state ?? { windowStart: now, count: 0 },
    };
  }

  const current = state && Number.isFinite(state.windowStart) ? state : { windowStart: now, count: 0 };
  if (now - current.windowStart >= windowMs) {
    const fresh = { windowStart: now, count: 1 };
    return { result: { allowed: true, remaining: limit - 1, retryAfterMs: 0 }, state: fresh };
  }

  if (current.count >= limit) {
    return {
      result: { allowed: false, remaining: 0, retryAfterMs: Math.max(0, current.windowStart + windowMs - now) },
      state: current,
    };
  }

  const next = { windowStart: current.windowStart, count: current.count + 1 };
  return { result: { allowed: true, remaining: limit - next.count, retryAfterMs: 0 }, state: next };
}

/**
 * Verify that a state-changing request originates from an allowed origin.
 *
 * A browser sends `Origin` on cross-site POSTs; when it is present it must be in
 * the allowlist. When it is absent (a server-to-server call, which cannot carry
 * a victim's cookies) the request is allowed only if it also lacks a browser
 * `Sec-Fetch-Site` value of `cross-site`. This blocks CSRF without breaking API
 * clients that authenticate with a bearer token.
 */
export function isAllowedOrigin(
  origin: string | null,
  allowedOrigins: string[],
  secFetchSite: string | null,
): boolean {
  if (origin) {
    return allowedOrigins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase());
  }
  if (secFetchSite && secFetchSite.toLowerCase() === 'cross-site') return false;
  return true;
}

/**
 * Reject input that looks like an attempt to inject SQL.
 *
 * This is a defence-in-depth guard for logging and diagnostics. It is *not*
 * the primary defence: every query in this codebase uses bound parameters, so
 * a value that trips this check is refused rather than interpolated.
 */
const SQL_INJECTION_PATTERN =
  /(\b(union\s+select|drop\s+table|insert\s+into|delete\s+from|update\s+set|alter\s+table)\b|--\s|\/\*|\*\/|;\s*(drop|delete|update|insert)\b)/i;

export function looksLikeSqlInjection(value: string): boolean {
  return SQL_INJECTION_PATTERN.test(value);
}

/**
 * Escape text that will be embedded in HTML.
 *
 * React escapes by default, so this exists for the rare place a string is
 * assembled into markup (an email body, a CSV cell) rather than rendered.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the rate-limit key for a caller from the forwarded address, falling
 * back to a supplied identity. A missing address is keyed by identity rather
 * than sharing one global bucket.
 */
export function rateLimitKey(forwardedFor: string | null, identity: string): string {
  const first = forwardedFor?.split(',')[0]?.trim();
  return first && first.length > 0 ? `ip:${first}` : `id:${identity}`;
}
