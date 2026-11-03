import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { fail, NO_STORE, symbolParam } from '@/lib/api/route-guards';

/**
 * Detailed view of one market across every venue.
 *
 * The venue is inferred from which listing table holds the symbol. An unknown
 * symbol returns 404 rather than an empty record.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } },
) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const symbol = symbolParam(decodeURIComponent(params.symbol));
  if (!symbol) return fail('VALIDATION_FAILED', 'Invalid market symbol');

  const db = getDb();

  const spot = db.prepare('SELECT * FROM trading_pairs WHERE symbol = ?').get(symbol);
  if (spot) return NextResponse.json({ success: true, venue: 'spot', market: spot }, { headers: NO_STORE });

  const futures = db.prepare('SELECT * FROM futures_markets WHERE symbol = ?').get(symbol);
  if (futures) return NextResponse.json({ success: true, venue: 'futures', market: futures }, { headers: NO_STORE });

  const options = db.prepare('SELECT * FROM options_markets WHERE symbol = ?').get(symbol);
  if (options) return NextResponse.json({ success: true, venue: 'options', market: options }, { headers: NO_STORE });

  const etf = db.prepare('SELECT * FROM etf_markets WHERE symbol = ?').get(symbol);
  if (etf) return NextResponse.json({ success: true, venue: 'etf', market: etf }, { headers: NO_STORE });

  const tradfi = db.prepare('SELECT * FROM tradfi_markets WHERE symbol = ?').get(symbol);
  if (tradfi) return NextResponse.json({ success: true, venue: 'tradfi', market: tradfi }, { headers: NO_STORE });

  return fail('UNKNOWN_SYMBOL', `${symbol} is not listed on any venue`, 404);
}
