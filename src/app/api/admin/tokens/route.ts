import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE, enforceRequestGuards } from '@/lib/api/route-guards';
import { listTokens, upsertToken, removeToken, removeTokenById, ChainError } from '@/lib/chains/registry';

/**
 * Token listing administration.
 *
 * A token is listed on a chain that is already listed: the row carries the
 * contract address and decimals the balance reader needs. A non-native EVM
 * token without a contract address is refused, because a balance read would
 * otherwise return zero and look like an empty account.
 *
 * Every mutation is audited.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const chainKey = request.nextUrl.searchParams.get('chainKey') ?? undefined;
  const tokens = listTokens(chainKey ?? undefined);
  return NextResponse.json({ success: true, tokens }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.tokens.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const token = upsertToken(body);
    recordAdminAction(request, auth.admin, 'admin.tokens.upsert', {
      type: 'blockchain_token',
      id: `${token.chainKey}:${token.symbol}`,
      detail: { contractAddress: token.contractAddress, status: token.status },
    });
    return NextResponse.json({ success: true, token }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChainError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.tokens.update');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const token = upsertToken(body);
    recordAdminAction(request, auth.admin, 'admin.tokens.update', {
      type: 'blockchain_token',
      id: `${token.chainKey}:${token.symbol}`,
      detail: { contractAddress: token.contractAddress, status: token.status },
    });
    return NextResponse.json({ success: true, token }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChainError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.tokens.delete');
  if (guard) return guard;

  const tokenId = (request.nextUrl.searchParams.get('tokenId') ?? '').trim();
  const chainKey = (request.nextUrl.searchParams.get('chainKey') ?? '').trim().toLowerCase();
  const symbol = (request.nextUrl.searchParams.get('symbol') ?? '').trim().toUpperCase();
  if (!tokenId && (!chainKey || !symbol)) {
    return fail('VALIDATION_FAILED', 'tokenId, or chainKey and symbol, are required');
  }

  try {
    let removed: unknown;
    if (tokenId) {
      removed = removeTokenById(tokenId);
    } else {
      removeToken(chainKey, symbol);
      removed = { chainKey, symbol };
    }
    recordAdminAction(request, auth.admin, 'admin.tokens.delete', {
      type: 'blockchain_token',
      id: tokenId ? `token:${tokenId}` : `${chainKey}:${symbol}`,
    });
    return NextResponse.json({ success: true, token: removed }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChainError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
