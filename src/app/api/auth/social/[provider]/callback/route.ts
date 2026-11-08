import { NextRequest, NextResponse } from 'next/server';
import {
  providerById,
  providerCredentials,
  verifyState,
  exchangeCode,
  fetchJwks,
  verifyIdToken,
  findOrCreateUser,
  createLoginCode,
  safeRedirectPath,
  OidcError,
} from '@/lib/auth/oidc';
import { issueSession } from '@/lib/security/session-issue';

/**
 * Complete a social sign-in.
 *
 * Verifies the signed state, exchanges the authorization code, checks the
 * id_token signature and claims against the provider's published keys, links or
 * creates the local account, then redirects with a single-use login code. The
 * session token is never placed in the redirect; the client redeems the code at
 * `/api/auth/social/exchange`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await params;
  const provider = providerById(providerId);
  if (!provider) {
    return errorRedirect(request, '/login', 'unknown_provider');
  }

  const credentials = providerCredentials(provider);
  if (!credentials) {
    return errorRedirect(request, '/login', 'provider_not_configured');
  }

  const search = request.nextUrl.searchParams;
  const providerError = search.get('error');
  if (providerError) {
    return errorRedirect(request, '/login', 'provider_denied');
  }

  const code = search.get('code');
  const stateToken = search.get('state');
  if (!code || !stateToken) {
    return errorRedirect(request, '/login', 'missing_code');
  }

  try {
    const state = verifyState(stateToken);
    if (state.provider !== provider.id) {
      throw new OidcError('INVALID_STATE', 'The sign-in state does not match the provider');
    }

    const redirectUri = `${request.nextUrl.origin}/api/auth/social/${provider.id}/callback`;
    const { idToken } = await exchangeCode(provider, {
      code,
      redirectUri,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });

    const jwks = await fetchJwks(provider);
    let claims;
    try {
      claims = verifyIdToken(idToken, jwks, {
        issuer: provider.issuer,
        clientId: credentials.clientId,
        nonce: state.nonce,
      });
    } catch (error) {
      // A key may have rotated since it was cached; refetch once before failing.
      if (error instanceof OidcError && error.code === 'INVALID_ID_TOKEN') {
        const refreshed = await fetchJwks(provider, true);
        claims = verifyIdToken(idToken, refreshed, {
          issuer: provider.issuer,
          clientId: credentials.clientId,
          nonce: state.nonce,
        });
      } else {
        throw error;
      }
    }

    const userId = findOrCreateUser(provider.id, claims);
    const session = issueSession(request, userId);
    const loginCode = createLoginCode(userId, session.accessToken, session.refreshToken);

    const destination = safeRedirectPath(state.redirect);
    const url = new URL('/auth/callback', request.nextUrl.origin);
    url.searchParams.set('loginCode', loginCode);
    url.searchParams.set('next', destination);
    return NextResponse.redirect(url);
  } catch (error) {
    const reason = error instanceof OidcError ? error.code.toLowerCase() : 'signin_failed';
    console.error('Social sign-in failed:', error instanceof OidcError ? error.message : error);
    return errorRedirect(request, '/login', reason);
  }
}

function errorRedirect(request: NextRequest, path: string, reason: string): NextResponse {
  const url = new URL(path, request.nextUrl.origin);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url, 303);
}
