import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { supply, borrow, repay, withdrawSupply, flashLoan, listLendingMarkets, marginPositions } from '@/lib/dex/margin-service';
import { dexFailure } from '@/lib/dex/route-helpers';

/**
 * TigerSwap lending and spot margin.
 *
 * `GET` lists the markets and the caller's positions; `POST` performs a supply,
 * borrow, repay, withdraw or flash loan, selected by `action`. Every movement is
 * a real ledger transfer.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(
      { success: true, markets: listLendingMarkets(), positions: marginPositions(auth.user.userId) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.margin', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const action = String(body.action ?? '').toLowerCase();
  const userId = auth.user.userId;
  const asset = String(body.asset ?? '');
  const amount = Number(body.amount);
  try {
    switch (action) {
      case 'supply':
        return NextResponse.json({ success: true, result: supply(userId, asset, amount) }, { status: 201, headers: NO_STORE });
      case 'borrow':
        return NextResponse.json(
          { success: true, result: borrow(userId, asset, amount, String(body.collateralAsset ?? ''), Number(body.collateralAmount)) },
          { status: 201, headers: NO_STORE },
        );
      case 'repay':
        return NextResponse.json(
          { success: true, result: repay(userId, asset, amount, String(body.collateralAsset ?? ''), Number(body.collateralAmount ?? 0)) },
          { headers: NO_STORE },
        );
      case 'withdraw':
        return NextResponse.json({ success: true, result: withdrawSupply(userId, asset, amount) }, { headers: NO_STORE });
      case 'flash-loan':
        return NextResponse.json({ success: true, result: flashLoan(userId, asset, amount) }, { headers: NO_STORE });
      default:
        return fail('INVALID_ACTION', 'action must be supply, borrow, repay, withdraw or flash-loan');
    }
  } catch (error) {
    return dexFailure(error);
  }
}
