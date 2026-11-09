import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { listVaults, depositVault, withdrawVault, vaultPositions } from '@/lib/dex/vault-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap auto-compounding vaults.
 *
 * `GET` lists the vaults and the caller's positions; `POST` deposits; `DELETE`
 * withdraws. Shares are priced against the vault's real assets, so a depositor
 * cannot claim rewards earned before they arrived.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(
      { success: true, vaults: listVaults(), positions: vaultPositions(auth.user.userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.vault.deposit', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const result = depositVault(auth.user.userId, String(body.vaultId ?? ''), Number(body.assets));
    return NextResponse.json({ success: true, deposit: result }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'dex.vault.withdraw', 30, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  const params = request.nextUrl.searchParams;
  try {
    const result = withdrawVault(
      auth.user.userId,
      String(body?.vaultId ?? params.get('vaultId') ?? ''),
      Number(body?.shares ?? params.get('shares')),
    );
    return NextResponse.json({ success: true, withdrawal: result }, { headers: NO_STORE });
  } catch (error) {
    return dexFailure(error);
  }
}
