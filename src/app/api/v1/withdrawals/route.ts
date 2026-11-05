import { NextRequest } from 'next/server';
import { requireApiKey, v1Ok } from '@/lib/api/v1-guard';
import { userWithdrawals } from '@/lib/wallet/withdrawals';

/** The key owner's withdrawal history. Requires the `read` permission. */
export async function GET(request: NextRequest) {
  const auth = await requireApiKey(request, 'read', '');
  if ('error' in auth) return auth.error;

  const asset = request.nextUrl.searchParams.get('coin') ?? request.nextUrl.searchParams.get('asset');
  const status = request.nextUrl.searchParams.get('status');
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);

  return v1Ok({
    withdrawals: userWithdrawals(auth.identity.userId, {
      asset: asset ?? undefined,
      status: status ?? undefined,
      limit,
    }),
  });
}
