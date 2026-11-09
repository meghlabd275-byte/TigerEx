import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { listHooks, setHook, removeHook } from '@/lib/dex/hook-service';
import { dexFailure } from '@/lib/dex/route-helpers';

export const dynamic = 'force-dynamic';

/**
 * TigerSwap V4 hook administration.
 *
 * Attach a hook to a pool, or detach one. The hook's configuration is validated
 * by running its rule before it is stored, so a hook that would throw on the
 * first swap cannot be saved. Every mutation is appended to the audit trail.
 */
function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const poolId = request.nextUrl.searchParams.get('poolId') ?? undefined;
  try {
    return NextResponse.json({ success: true, hooks: listHooks(poolId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  try {
    const hook = setHook({
      poolId: String(body.poolId ?? ''),
      kind: String(body.kind ?? ''),
      config: (body.config ?? {}) as Record<string, unknown>,
    });
    recordAdminAction(request, auth.admin, 'dex.hook.set', { type: 'pool', id: hook.poolId, detail: { kind: hook.kind, config: hook.config } });
    return NextResponse.json({ success: true, hook }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return dexFailure(error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const params = request.nextUrl.searchParams;
  const poolId = String(params.get('poolId') ?? '');
  const kind = String(params.get('kind') ?? '');
  if (!poolId || !kind) return fail('INVALID_HOOK', 'poolId and kind are required');

  try {
    const result = removeHook(poolId, kind);
    recordAdminAction(request, auth.admin, 'dex.hook.remove', { type: 'pool', id: poolId, detail: { kind } });
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return dexFailure(error);
  }
}
