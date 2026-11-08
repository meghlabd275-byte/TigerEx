import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import {
  listNetworks,
  upsertNetwork,
  removeNetwork,
  NetworkError,
} from '@/lib/wallet/networks';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Deposit network administration.
 *
 * The operator lists which asset may be deposited on which chain and its
 * minimum and confirmation policy. The deposit view reads the same rows, so a
 * network that is paused here stops being offered there and stops issuing
 * addresses. Every mutation is audited.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status');
  const networks = listNetworks(status ? { status } : {});
  return NextResponse.json({ success: true, networks, data: networks }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.networks.upsert');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const network = upsertNetwork(body);
    recordAdminAction(request, auth.admin, 'network.upsert', {
      type: 'deposit_network',
      id: `${network.asset}/${network.network}`,
      detail: network,
    });
    return NextResponse.json({ success: true, network }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof NetworkError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.networks.remove');
  if (guard) return guard;

  const asset = (request.nextUrl.searchParams.get('asset') ?? '').trim();
  const network = (request.nextUrl.searchParams.get('network') ?? '').trim();
  if (!asset || !network) return fail('VALIDATION_FAILED', 'asset and network query parameters are required');

  try {
    removeNetwork(asset, network);
    recordAdminAction(request, auth.admin, 'network.remove', {
      type: 'deposit_network',
      id: `${asset.toUpperCase()}/${network.toUpperCase()}`,
    });
    return NextResponse.json({ success: true, asset, network }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof NetworkError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
