import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Get Wallet Balance - Production Implementation
 * Returns the authenticated user's balances with a USD valuation derived from
 * the live `market_data` table. Assets with no listed price are reported as
 * unpriced and excluded from the total instead of being valued at an invented
 * rate.
 */

// Assets that are USD-denominated by design and therefore valued 1:1.
const USD_DENOMINATED = new Set(['USD', 'USDT', 'USDC', 'RUSD', 'RYUSD', 'DAI', 'TUSD', 'FDUSD']);

function usdPrice(currency: string): number | null {
  const asset = currency.toUpperCase();
  if (USD_DENOMINATED.has(asset)) return 1;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT price FROM market_data
        WHERE symbol IN (?, ?) AND price IS NOT NULL AND price > 0
        LIMIT 1`,
    )
    .get(`${asset}USDT`, `${asset}/USDT`) as { price: number } | undefined;

  return row && row.price > 0 ? row.price : null;
}

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    const db = getDb();

    // Find session by token
    const session = db.prepare(`
      SELECT user_id FROM sessions
      WHERE access_token = ? AND expires_at > datetime('now')
    `).get(token) as { user_id: string } | undefined;

    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Balances live in `balances`, keyed by wallet_id; wallets carry the owner
    // and currency. The previous query read non-existent `wallets.balance` and
    // `wallets.usd_price` columns and defaulted a missing price to $1.
    const rows = db.prepare(`
      SELECT b.currency AS currency, b.available AS available, b.locked AS locked
        FROM balances b
        JOIN wallets w ON b.wallet_id = w.wallet_id
       WHERE w.user_id = ?
    `).all(session.user_id) as Array<{
      currency: string;
      available: number | null;
      locked: number | null;
    }>;

    // Merge the same currency held across multiple wallets into one balance.
    const merged = new Map<string, { available: number; locked: number }>();
    for (const row of rows) {
      const currency = String(row.currency).toUpperCase();
      const entry = merged.get(currency) ?? { available: 0, locked: 0 };
      entry.available += Number(row.available) || 0;
      entry.locked += Number(row.locked) || 0;
      merged.set(currency, entry);
    }

    let totalUSDT = 0;
    const unpriced: string[] = [];
    const balances = Array.from(merged.entries()).map(([coin, entry]) => {
      const price = usdPrice(coin);
      if (price === null) unpriced.push(coin);
      const total = entry.available + entry.locked;
      const usdValue = price === null ? null : total * price;
      if (usdValue !== null) totalUSDT += usdValue;
      return {
        coin,
        free: entry.available,
        locked: entry.locked,
        usdPrice: price,
        usdValue,
      };
    });

    return NextResponse.json({
      success: true,
      balances,
      totalUSDT,
      unpricedAssets: unpriced,
    });
  } catch (error: any) {
    console.error('Balance API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
