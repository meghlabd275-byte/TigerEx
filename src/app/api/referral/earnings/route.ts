import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listCommissions } from '@/lib/db/referral';

const MAX_LIMIT = 100;

/** Alias of the commission ledger, presented as earnings for the referrer. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), MAX_LIMIT);
  const offset = (page - 1) * limit;

  try {
    const commissions = listCommissions(auth.user.userId, limit, offset);
    const total = commissions.reduce((sum, c) => sum + c.amount, 0);
    return NextResponse.json(
      { success: true, data: commissions, page, limit, pageTotal: total },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Referral earnings error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
