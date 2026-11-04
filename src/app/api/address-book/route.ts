import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { addressBook } from '@/lib/wallet/withdrawals';
import { validateAddress } from '@/lib/wallet/address';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The account's saved withdrawal addresses.
 *
 * GET lists them; POST saves one. An address is stored only after it passes the
 * real checksum for its network, so the book can never hold an address the
 * exchange would refuse at withdrawal time.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const asset = request.nextUrl.searchParams.get('asset') ?? request.nextUrl.searchParams.get('coin');
  const entries = addressBook(auth.user.userId, asset ?? undefined);
  return NextResponse.json({ success: true, entries, addresses: entries, data: entries }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'address-book');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const asset = String(body.asset ?? body.coin ?? '').trim().toUpperCase();
  const network = String(body.network ?? '').trim().toUpperCase();
  const address = String(body.address ?? '').trim();
  const label = body.label === undefined || body.label === null ? null : String(body.label).slice(0, 64);

  if (!asset) return fail('VALIDATION_FAILED', 'An asset is required');
  if (!network) return fail('VALIDATION_FAILED', 'A network is required');

  const checked = validateAddress(network, address);
  if (!checked.valid || !checked.normalized) {
    return fail('INVALID_ADDRESS', checked.reason ?? 'The address is not valid');
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT entry_id FROM withdrawal_whitelist WHERE user_id = ? AND asset = ? AND network = ? AND address = ?')
    .get(auth.user.userId, asset, network, checked.normalized) as { entry_id: string } | undefined;
  if (existing) {
    return NextResponse.json({ success: true, id: existing.entry_id, duplicate: true }, { headers: NO_STORE });
  }

  const entryId = generateId();
  db.prepare(
    `INSERT INTO withdrawal_whitelist (entry_id, user_id, asset, network, address, label, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
  ).run(entryId, auth.user.userId, asset, network, checked.normalized, label);

  return NextResponse.json(
    { success: true, id: entryId, entry_id: entryId, asset, network, address: checked.normalized, label },
    { headers: NO_STORE },
  );
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'address-book');
  if (guard) return guard;

  const entryId = (request.nextUrl.searchParams.get('addressId') ?? request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!entryId) return fail('VALIDATION_FAILED', 'An address id is required');

  const result = getDb()
    .prepare('DELETE FROM withdrawal_whitelist WHERE entry_id = ? AND user_id = ?')
    .run(entryId, auth.user.userId);
  if (result.changes === 0) return fail('NOT_FOUND', 'No such saved address', 404);

  return NextResponse.json({ success: true, id: entryId }, { headers: NO_STORE });
}
