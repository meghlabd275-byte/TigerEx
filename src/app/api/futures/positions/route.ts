import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/db/session';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's open derivative positions.
 *
 * Reads the exchange's own `futures_positions` table. An account with no open
 * position receives an empty list, never a placeholder position.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const symbol = request.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  const clauses = ["user_id = ?", "status = 'open'"];
  const params: string[] = [auth.user.userId];
  if (symbol) {
    clauses.push('symbol = ?');
    params.push(symbol);
  }

  const rows = getDb()
    .prepare(`SELECT * FROM futures_positions WHERE ${clauses.join(' AND ')} ORDER BY opened_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      positions: rows.map((row) => ({
        id: row.position_id,
        positionId: row.position_id,
        symbol: row.symbol,
        contract_symbol: row.symbol,
        side: row.side,
        quantity: row.quantity,
        entry_price: row.entry_price,
        entryPrice: row.entry_price,
        mark_price: row.mark_price,
        markPrice: row.mark_price,
        leverage: row.leverage,
        margin_mode: row.margin_mode,
        position_mode: row.position_mode,
        margin: row.margin,
        liquidation_price: row.liquidation_price,
        liquidationPrice: row.liquidation_price,
        unrealized_pnl: row.unrealized_pnl,
        unrealizedPnl: row.unrealized_pnl,
        realized_pnl: row.realized_pnl,
        status: row.status,
        openedAt: row.opened_at,
      })),
    },
    { headers: NO_STORE },
  );
}
