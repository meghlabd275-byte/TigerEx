import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE, enforceRequestGuards } from '@/lib/api/route-guards';
import { listChains, upsertChain, removeChain, ChainError } from '@/lib/chains/registry';

/**
 * Blockchain listing administration.
 *
 * An administrator lists the chains the exchange serves, sets the node URL the
 * balance reader dials and the chain id that node must report, and pauses or
 * removes a chain. Nothing is compiled in: a chain exists only once it is
 * listed here, so the exchange never reads a balance from an endpoint an
 * operator did not configure.
 *
 * Every mutation is audited. Removal is refused while tokens or deposit
 * addresses still reference the chain.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status') ?? undefined;
  const chains = listChains(status ? { status } : {});
  return NextResponse.json({ success: true, chains }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.chains.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const chain = upsertChain(body);
    recordAdminAction(request, auth.admin, 'admin.chains.upsert', {
      type: 'blockchain_chain',
      id: chain.chainKey,
      detail: { chainId: chain.chainId, status: chain.status },
    });
    return NextResponse.json({ success: true, chain }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChainError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.chains.update');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const chain = upsertChain(body);
    recordAdminAction(request, auth.admin, 'admin.chains.update', {
      type: 'blockchain_chain',
      id: chain.chainKey,
      detail: { chainId: chain.chainId, status: chain.status },
    });
    return NextResponse.json({ success: true, chain }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChainError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.chains.delete');
  if (guard) return guard;

  const chainKey = (request.nextUrl.searchParams.get('chainKey') ?? '').trim().toLowerCase();
  if (!chainKey) return fail('VALIDATION_FAILED', 'chainKey query parameter is required');

  try {
    removeChain(chainKey);
    recordAdminAction(request, auth.admin, 'admin.chains.delete', {
      type: 'blockchain_chain',
      id: chainKey,
    });
    return NextResponse.json({ success: true, chainKey }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ChainError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
