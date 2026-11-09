import { NextRequest, NextResponse } from 'next/server';
import { verifyChallenge, openWalletSession, WalletAuthError } from '@/lib/auth/wallet';
import { enforceRequestGuards, readJson, NO_STORE } from '@/lib/api/route-guards';

/**
 * Register with a wallet.
 *
 * The caller signs a challenge proving control of the address; that address
 * becomes the account's identity. An optional email is attached to the new
 * account when supplied.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.wallet.register', 10, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'A JSON object body is required' } },
      { status: 400 },
    );
  }

  try {
    const address = verifyChallenge(body.challengeId, body.signature);
    const session = openWalletSession(address, {
      create: true,
      email: typeof body.email === 'string' ? body.email : null,
      ip: request.headers.get('x-forwarded-for'),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json(
      {
        success: true,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        user: { userId: session.userId, walletAddress: session.address },
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers: NO_STORE },
      );
    }
    throw error;
  }
}

