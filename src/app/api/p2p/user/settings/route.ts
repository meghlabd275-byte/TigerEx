import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { p2pSettings, updateP2pSettings, P2pProfileError } from '@/lib/p2p/profile';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's P2P settings.
 *
 * Auto-reply, the payment window and the blocked-counterparty list are stored
 * in the account's own preferences, so they survive a reload and are the values
 * the P2P order path reads.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const settings = p2pSettings(auth.user.userId);
  return NextResponse.json({ success: true, settings, data: settings }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'p2p.user.settings');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const settings = updateP2pSettings(auth.user.userId, body);
    return NextResponse.json({ success: true, settings, data: settings }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof P2pProfileError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
