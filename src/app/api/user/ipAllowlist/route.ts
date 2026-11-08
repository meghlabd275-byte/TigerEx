import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import {
  listIpAllowlist,
  addIpAllowlistEntry,
  removeIpAllowlistEntry,
  securitySettings,
  AccountError,
} from '@/lib/security/account';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The account's sign-in IP allowlist.
 *
 * GET lists the entries plus whether the control is on; POST adds a CIDR;
 * DELETE removes one. Every entry is validated before it is stored, so a
 * malformed range can never end up guarding (or failing to guard) sign-in.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const entries = listIpAllowlist(auth.user.userId);
  const enabled = securitySettings(auth.user.userId).ip_whitelist_enabled;
  return NextResponse.json(
    { success: true, enabled, entries, data: entries },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'user.ipAllowlist.add');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const cidr = String(body.cidr ?? body.ip ?? '').trim();
  if (!cidr) return fail('VALIDATION_FAILED', 'A cidr is required');
  const label = body.label === undefined || body.label === null ? null : String(body.label).slice(0, 64);

  try {
    const entry = addIpAllowlistEntry(auth.user.userId, cidr, label);
    return NextResponse.json({ success: true, entry }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'user.ipAllowlist.remove');
  if (guard) return guard;

  const entryId = (request.nextUrl.searchParams.get('entryId') ?? request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!entryId) return fail('VALIDATION_FAILED', 'An entryId is required');

  try {
    removeIpAllowlistEntry(auth.user.userId, entryId);
    return NextResponse.json({ success: true, entryId }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
