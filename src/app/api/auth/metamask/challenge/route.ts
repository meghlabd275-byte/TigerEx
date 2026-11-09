import { NextRequest, NextResponse } from 'next/server';
import { issueChallenge, WalletAuthError } from '@/lib/auth/wallet';
import { enforceRequestGuards, readJson, NO_STORE } from '@/lib/api/route-guards';

/**
 * Issue a single-use challenge for a wallet to sign.
 *
 * Unauthenticated by design: the challenge grants nothing on its own and is
 * only useful to a caller that can sign it. It is tightly rate limited so a
 * caller cannot mint challenges without bound.
 */
export async function POST(request: NextRequest) {
  const guard = enforceRequestGuards(request, 'auth.wallet.challenge', 20, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'A JSON object body is required' } },
      { status: 400 },
    );
  }

  try {
    const challenge = issueChallenge(body.address);
    return NextResponse.json({ success: true, ...challenge }, { headers: NO_STORE });
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
