/**
 * Shared helpers for the native (database-backed) API routes.
 *
 * Every administrative route authenticates through `requireAdmin`, checks the
 * request origin for state-changing methods, and is rate limited. Those checks
 * live here so a new route cannot forget one of them by accident.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isAllowedOrigin, checkRateLimit, rateLimitKey } from '@/lib/security/guards';
import { validateJsonInput, InputValidationError } from '@/lib/security/input-guard';

/** Standard error envelope used by every native route. */
export function fail(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

/** Responses that carry account or market state must never be cached. */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * Read and structurally validate a JSON object body.
 *
 * Returns null when the body is missing, malformed, not an object, or fails the
 * structural guard (poisoned keys, unbounded depth/size, control characters), so
 * a route that checks `if (!body) return fail(...)` refuses it. The validation
 * is applied here rather than per route so a new route cannot forget it.
 */
export async function readJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  try {
    validateJsonInput(body);
  } catch (error) {
    if (error instanceof InputValidationError) return null;
    throw error;
  }
  return body as Record<string, unknown>;
}

/**
 * Parse a JSON column that may be a string or already decoded.
 *
 * Returns the fallback rather than throwing so a legacy row cannot crash a list
 * endpoint; the fallback is a genuine empty value, not a fabricated one.
 */
export function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** The origins permitted to call state-changing routes, from the environment. */
function allowedOrigins(): string[] {
  return (process.env.TIGEREX_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * The request's own origin, reconstructed from the host headers.
 *
 * A browser sets `Host` to the address it connected to, so a request that
 * reaches this server has a host the caller did not choose; a cross-site page
 * cannot forge it. This value is used only to recognise a same-origin request,
 * which by definition is not CSRF.
 */
function requestOrigin(request: NextRequest): string | null {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return null;
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    (request.nextUrl.protocol ? request.nextUrl.protocol.replace(':', '') : 'https');
  return `${proto}://${host}`;
}

/**
 * Reject a state-changing request that did not originate from an allowed
 * origin. Read-only methods are not checked because they cannot be used to
 * perform an action on a victim's behalf.
 *
 * A request whose `Origin` matches the host it was sent to is same-origin and
 * is always permitted; otherwise the configured allowlist decides. This means
 * the app's own pages work without an operator having to list their own host,
 * while a cross-site request is still refused.
 */
export function enforceOrigin(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;

  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');

  const own = requestOrigin(request);
  const allowed = own ? [...allowedOrigins(), own] : allowedOrigins();
  if (isAllowedOrigin(origin, allowed, site)) return null;

  return fail('ORIGIN_NOT_ALLOWED', 'This origin is not permitted to perform the request', 403);
}

/**
 * Enforce a fixed-window rate limit backed by the `api_rate_usage` table.
 *
 * The counter is durable so a burst spread across processes still adds up. A
 * limit of zero or less disables the check for read-only telemetry endpoints.
 */
export function enforceRateLimit(
  request: NextRequest,
  bucket: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;

  const db = getDb();
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${bucket}:${rateLimitSubject(request)}`;

  const row = db
    .prepare('SELECT request_count FROM api_rate_usage WHERE key_id = ? AND window_start = ?')
    .get(key, windowStart) as { request_count: number } | undefined;

  const state = row ? { windowStart, count: row.request_count } : null;
  const { result } = checkRateLimit(state, limit, windowMs, now);
  if (!result.allowed) {
    return fail('RATE_LIMITED', 'Too many requests; retry after the window resets', 429);
  }

  db.prepare(
    `INSERT INTO api_rate_usage (key_id, window_start, request_count)
     VALUES (?, ?, 1)
     ON CONFLICT(key_id, window_start) DO UPDATE SET request_count = request_count + 1`,
  ).run(key, windowStart);

  // Opportunistically drop windows older than an hour so the table stays small.
  db.prepare('DELETE FROM api_rate_usage WHERE window_start < ?').run(now - 60 * 60 * 1000);

  return null;
}

/** Rate-limit subject: the forwarded client address, else the user agent. */
function rateLimitSubject(request: NextRequest): string {
  return rateLimitKey(request.headers.get('x-forwarded-for'), request.headers.get('user-agent') || 'unknown');
}

/**
 * Combine the origin and rate-limit checks for a mutating route.
 *
 * Returns the error response to send, or null when the request may proceed.
 */
export function enforceRequestGuards(
  request: NextRequest,
  bucket: string,
  limit = 120,
  windowMs = 60_000,
): NextResponse | null {
  return enforceOrigin(request) ?? enforceRateLimit(request, bucket, limit, windowMs);
}

/** Coerce a value to a finite number, or null when it is not usable. */
export function finite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a value to a positive finite number, or null. */
export function positive(value: unknown): number | null {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
}

/** Coerce a value to an uppercase, trimmed string. */
export function upper(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Normalize a query-parameter symbol such as `btc/usdt` to `BTC/USDT`. */
export function symbolParam(value: string | null): string | null {
  if (!value) return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(symbol) ? symbol : null;
}
