import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { getDb } from '@/lib/db';
import { NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * The caller's own liquidation history.
 *
 * Read from the exchange's own `liquidation_queue`: the rows the risk engine
 * created when one of this account's positions breached its maintenance margin.
 * An account that has never been liquidated gets an empty list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const bounded = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50;

  const rows = getDb()
    .prepare('SELECT * FROM liquidation_queue WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(auth.user.userId, bounded) as Array<Record<string, unknown>>;

  const liquidations = rows.map((row) => ({
    id: row.entry_id,
    entryId: row.entry_id,
    symbol: row.symbol,
    positionType: row.position_type,
    position_type: row.position_type,
    quantity: Number(row.quantity),
    entryPrice: Number(row.entry_price),
    entry_price: Number(row.entry_price),
    markPrice: Number(row.mark_price),
    mark_price: Number(row.mark_price),
    marginRatio: Number(row.margin_ratio),
    margin_ratio: Number(row.margin_ratio),
    status: row.status,
    createdAt: row.created_at,
    created_at: row.created_at,
    executedAt: row.executed_at ?? null,
  }));

  return NextResponse.json({ success: true, liquidations, data: liquidations }, { headers: NO_STORE });
}
