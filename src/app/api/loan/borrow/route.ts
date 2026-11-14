import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { borrow, MarginError } from '@/lib/trading/margin-engine';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Borrow against collateral.
 *
 * The listed margin markets describe what may be borrowed and posted; the
 * response exposes those parameters so a client can pre-check a request.
 */
export async function GET() {
  const rows = getDb()
    .prepare("SELECT * FROM margin_markets WHERE status = 'active' ORDER BY symbol")
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      markets: rows.map((row) => ({
        symbol: row.symbol,
        mode: row.mode,
        maxLeverage: row.max_leverage,
        collateralLtv: row.collateral_ltv,
        borrowableAssets: row.borrowable_assets,
        interestBaseApr: row.interest_base_apr,
        riskTier: row.risk_tier,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'margin.borrow');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const loan = borrow(auth.user.userId, {
      symbol: String(body.symbol ?? body.pair ?? ''),
      mode: body.mode === undefined ? undefined : String(body.mode),
      asset: String(body.asset ?? body.loanAsset ?? ''),
      amount: Number(body.amount),
      collateralAsset: String(body.collateralAsset ?? ''),
      collateralAmount: Number(body.collateralAmount),
    });
    return NextResponse.json({ success: true, loan }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof MarginError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
