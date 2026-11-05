/**
 * Request-side glue for the public `/api/v1` gateway.
 *
 * The gateway authenticates every request with an HMAC-signed API key (see
 * `api-auth.ts`) rather than a session bearer token, so a machine client never
 * needs a browser session. A failed check returns a ready-to-send error
 * response; there is no anonymous fallback.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest, ApiAuthError, type ApiPermission } from '@/lib/api/api-auth';
import { enforceOrigin, enforceRateLimit, NO_STORE } from '@/lib/api/route-guards';

export interface V1Identity {
  userId: string;
  keyId: string;
}

function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get('x-real-ip')?.trim() ?? null;
}

/**
 * Authenticate a `/api/v1` request.
 *
 * Returns either the caller's identity or an error response. `body` must be the
 * exact request body string, since it is part of the signed payload.
 */
export async function requireApiKey(
  request: NextRequest,
  permission: ApiPermission,
  body: string,
): Promise<{ identity: V1Identity } | { error: NextResponse }> {
  const guard = enforceOrigin(request) ?? enforceRateLimit(request, `api.v1.${permission}`, 600, 60_000);
  if (guard) return { error: guard };

  try {
    const result = authenticateApiRequest(
      {
        apiKey: request.headers.get('x-tigerex-api-key') ?? '',
        timestamp: request.headers.get('x-tigerex-timestamp') ?? '',
        signature: request.headers.get('x-tigerex-signature') ?? '',
      },
      request.method,
      request.nextUrl.pathname,
      body,
      permission,
      clientIp(request),
    );
    return { identity: { userId: result.userId, keyId: result.keyId } };
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return {
        error: NextResponse.json(
          { success: false, error: { code: error.code, message: error.message } },
          { status: error.status, headers: NO_STORE },
        ),
      };
    }
    throw error;
  }
}

/** Send a successful gateway response. */
export function v1Ok(payload: Record<string, unknown>): NextResponse {
  return NextResponse.json({ success: true, ...payload }, { headers: NO_STORE });
}

/** Send a gateway error. */
export function v1Error(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status, headers: NO_STORE });
}
