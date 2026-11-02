import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { SYMBOL_RE, validatePairInput } from '@/lib/markets/listing';

/**
 * Spot market listing administration.
 *
 * Every mutation is authenticated as an administrator, validated, written to
 * `trading_pairs`, and appended to the immutable audit trail. Nothing here
 * depends on an external backend or mirrors another exchange's listing.
 */

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

// List every spot market with its fee schedule and current price.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, m.price AS current_price
         FROM trading_pairs p
         LEFT JOIN market_data m ON m.symbol = p.symbol
        ORDER BY p.symbol`,
    )
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      markets: rows.map((row) => ({
        symbol: row.symbol,
        baseCurrency: row.base_currency,
        quoteCurrency: row.quote_currency,
        status: row.status,
        minPrice: row.min_price,
        maxPrice: row.max_price,
        tickSize: row.tick_size,
        minQuantity: row.min_quantity,
        maxQuantity: row.max_quantity,
        minNotional: row.min_notional,
        makerFee: row.maker_fee,
        takerFee: row.taker_fee,
        currentPrice: row.current_price ?? null,
        createdAt: row.created_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// List a new spot market.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const validated = validatePairInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const { pair } = validated;

  const db = getDb();
  const existing = db.prepare('SELECT 1 FROM trading_pairs WHERE symbol = ?').get(pair.symbol);
  if (existing) return fail('DUPLICATE_SYMBOL', `${pair.symbol} is already listed`, 409);

  db.prepare(
    `INSERT INTO trading_pairs
       (pair_id, base_currency, quote_currency, symbol, status,
        min_price, max_price, tick_size, min_quantity, max_quantity,
        min_notional, maker_fee, taker_fee)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    pair.baseCurrency,
    pair.quoteCurrency,
    pair.symbol,
    pair.status,
    pair.minPrice,
    pair.maxPrice,
    pair.tickSize,
    pair.minQuantity,
    pair.maxQuantity,
    pair.minNotional,
    pair.makerFee,
    pair.takerFee,
  );

  recordAdminAction(request, auth.admin, 'market.spot.list', {
    type: 'trading_pair',
    id: pair.symbol,
    detail: pair,
  });

  return NextResponse.json({ success: true, market: pair }, { status: 201 });
}

// Update an existing listing's status, limits or fees.
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }

  const validated = validatePairInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const { pair } = validated;

  const db = getDb();
  const existing = db.prepare('SELECT 1 FROM trading_pairs WHERE symbol = ?').get(pair.symbol);
  if (!existing) return fail('UNKNOWN_SYMBOL', `${pair.symbol} is not listed`, 404);

  db.prepare(
    `UPDATE trading_pairs
        SET status = ?, min_price = ?, max_price = ?, tick_size = ?,
            min_quantity = ?, max_quantity = ?, min_notional = ?,
            maker_fee = ?, taker_fee = ?
      WHERE symbol = ?`,
  ).run(
    pair.status,
    pair.minPrice,
    pair.maxPrice,
    pair.tickSize,
    pair.minQuantity,
    pair.maxQuantity,
    pair.minNotional,
    pair.makerFee,
    pair.takerFee,
    pair.symbol,
  );

  recordAdminAction(request, auth.admin, 'market.spot.update', {
    type: 'trading_pair',
    id: pair.symbol,
    detail: pair,
  });

  return NextResponse.json({ success: true, market: pair });
}

// Delist a market. A market with working orders is refused: delisting under
// live orders would strand them.
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const symbol = new URL(request.url).searchParams.get('symbol')?.trim().toUpperCase();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return fail('VALIDATION_FAILED', 'symbol query parameter is required');
  }

  const db = getDb();
  const pair = db.prepare('SELECT pair_id FROM trading_pairs WHERE symbol = ?').get(symbol) as
    | { pair_id: string }
    | undefined;
  if (!pair) return fail('UNKNOWN_SYMBOL', `${symbol} is not listed`, 404);

  const openOrders = db
    .prepare(
      `SELECT COUNT(*) AS n FROM orders
        WHERE pair_id = ? AND status IN ('pending', 'open', 'partially_filled')`,
    )
    .get(pair.pair_id) as { n: number };
  if (openOrders.n > 0) {
    return fail(
      'OPEN_ORDERS_PRESENT',
      `${symbol} has ${openOrders.n} working order(s); cancel or pause before delisting`,
      409,
    );
  }

  db.prepare('DELETE FROM trading_pairs WHERE symbol = ?').run(symbol);
  db.prepare('DELETE FROM market_data WHERE symbol = ?').run(symbol);

  recordAdminAction(request, auth.admin, 'market.spot.delist', {
    type: 'trading_pair',
    id: symbol,
  });

  return NextResponse.json({ success: true, symbol });
}
