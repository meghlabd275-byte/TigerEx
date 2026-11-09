import { NextRequest, NextResponse } from 'next/server';
import { verifyChallenge, openWalletSession, WalletAuthError } from '@/lib/auth/wallet';
import { enforceRequestGuards, readJson, NO_STORE } from '@/lib/api/route-guards';

/**
 * Sign in with a wallet.
 *
 * The caller must first obtain a challenge and sign it; the recovered address
 * must already be linked to an account. A wallet that has never registered is
 * refused, so this endpoint cannot silently create accounts.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.wallet.login', 10, 60_000);
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
      create: false,
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
      { headers: NO_STORE },
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

