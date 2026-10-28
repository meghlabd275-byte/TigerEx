import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { getDb, generateId } from '@/lib/db';

const CARD_TYPES = new Set(['virtual', 'physical']);
const CARD_CURRENCIES = new Set(['USDT', 'USD', 'EUR', 'GBP']);

/**
 * Record a card application for the authenticated user.
 *
 * The card is created in `requested` state with no card number: issuance
 * happens at the card processor, and a PAN is only ever attached once the
 * processor returns it. This endpoint never fabricates a card number.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: { cardType?: unknown; currency?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const cardType = String(body.cardType ?? '').toLowerCase();
  const currency = String(body.currency ?? 'USDT').toUpperCase();

  if (!CARD_TYPES.has(cardType)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_CARD_TYPE', message: 'cardType must be virtual or physical' } },
      { status: 400 },
    );
  }
  if (!CARD_CURRENCIES.has(currency)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_CURRENCY', message: 'Unsupported spending currency' } },
      { status: 400 },
    );
  }

  try {
    const db = getDb();

    const pending = db
      .prepare(`SELECT 1 FROM cards WHERE user_id = ? AND status = 'requested'`)
      .get(auth.user.userId);
    if (pending) {
      return NextResponse.json(
        { success: false, error: { code: 'ALREADY_REQUESTED', message: 'A card request is already pending' } },
        { status: 409 },
      );
    }

    const cardId = generateId();
    db.prepare(
      `INSERT INTO cards (card_id, user_id, card_type, currency, status)
       VALUES (?, ?, ?, ?, 'requested')`,
    ).run(cardId, auth.user.userId, cardType, currency);

    return NextResponse.json(
      { success: true, data: { cardId, cardType, currency, status: 'requested' } },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Card order error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
