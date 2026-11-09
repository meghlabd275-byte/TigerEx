import { NextResponse } from 'next/server';

type UnavailableProvider = 'otp-delivery' | 'mfa-enrollment' | 'mfa-management';

const messages: Record<UnavailableProvider, string> = {
  'otp-delivery': 'Verification-code delivery is unavailable until a real delivery provider and shared, durable challenge storage are configured.',
  'mfa-enrollment': 'Multi-factor enrollment is unavailable until the authenticated session is verified and the secret can be stored encrypted.',
  'mfa-management': 'Multi-factor changes are unavailable until the authenticator secret and submitted code can be verified against durable account state.',
};

/** Fail closed when a security flow lacks its required trusted provider. */
export function unavailableAuthProvider(provider: UnavailableProvider) {
  return NextResponse.json(
    { success: false, error: { code: 'AUTH_PROVIDER_NOT_CONFIGURED', message: messages[provider] } },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
  );
}
