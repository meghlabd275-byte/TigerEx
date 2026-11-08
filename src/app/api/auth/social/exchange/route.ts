import { NextRequest, NextResponse } from 'next/server';
import { redeemLoginCode, OidcError } from '@/lib/auth/oidc';
import { readJson, fail, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Exchange a social sign-in code for session tokens.
 *
 * The callback redirects with an opaque, single-use code rather than the access
 * token, so the credential never lands in browser history, a referrer header or
 * a server log. Redeeming the code marks it used, so a replay is refused.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.social.exchange');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const code = String(body.code ?? '').trim();
  if (!code) return fail('VALIDATION_FAILED', 'A code is required');

  try {
    const redeemed = redeemLoginCode(code);
    return NextResponse.json(
      { success: true, accessToken: redeemed.accessToken, refreshToken: redeemed.refreshToken },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof OidcError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
