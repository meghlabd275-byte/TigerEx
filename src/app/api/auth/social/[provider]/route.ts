import { NextRequest, NextResponse } from 'next/server';
import {
  providerById,
  providerCredentials,
  signState,
  buildAuthorizationUrl,
  safeRedirectPath,
  OidcError,
} from '@/lib/auth/oidc';
import { randomBytes } from 'crypto';

/**
 * Start a social sign-in.
 *
 * Builds the provider's authorization URL with a signed, single-use state and a
 * nonce, then redirects the browser. A provider with no configured client
 * credentials fails closed: the exchange never pretends a provider works when
 * it cannot verify the result.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await params;
  const provider = providerById(providerId);
  if (!provider) {
    return NextResponse.json(
      { success: false, error: { code: 'UNKNOWN_PROVIDER', message: 'That sign-in provider is not supported' } },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const credentials = providerCredentials(provider);
  if (!credentials) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'PROVIDER_NOT_CONFIGURED',
          message: `${provider.label} sign-in is unavailable until ${provider.clientIdEnv} and ${provider.clientSecretEnv} are configured`,
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
    );
  }

  const redirect = safeRedirectPath(request.nextUrl.searchParams.get('redirect'));
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/social/${provider.id}/callback`;

  try {
    const nonce = randomBytes(16).toString('hex');
    const state = signState({
      provider: provider.id,
      nonce,
      redirect,
      issuedAt: Date.now(),
    });
    const url = buildAuthorizationUrl(provider, {
      clientId: credentials.clientId,
      redirectUri,
      state,
      nonce,
    });
    return NextResponse.redirect(url);
  } catch (error) {
    if (error instanceof OidcError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }
}
