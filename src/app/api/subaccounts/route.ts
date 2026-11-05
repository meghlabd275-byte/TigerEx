import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listSubaccounts, createSubaccount, setSubaccountStatus, SubaccountError } from '@/lib/account/subaccounts';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's own sub-accounts.
 *
 * A parent account may create up to 300 sub-accounts to isolate balances and
 * API keys. Reads and writes are scoped to the authenticated parent, so one
 * account can never see or change another's sub-accounts.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const subaccounts = listSubaccounts(auth.user.userId);
  return NextResponse.json({ success: true, subaccounts, data: subaccounts }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'subaccount.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
  try {
    const subaccount = createSubaccount(
      auth.user.userId,
      String(body.email ?? ''),
      body.label === undefined || body.label === null ? undefined : String(body.label),
      permissions,
    );
    return NextResponse.json({ success: true, subaccount, data: subaccount }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof SubaccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

/** Freeze or reactivate one of the caller's sub-accounts. */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'subaccount.status');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const subaccount = setSubaccountStatus(
      auth.user.userId,
      String(body.subaccountId ?? body.id ?? ''),
      String(body.status ?? ''),
    );
    return NextResponse.json({ success: true, subaccount, data: subaccount }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SubaccountError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
