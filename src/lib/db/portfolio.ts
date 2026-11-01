import { getDb } from '@/lib/db';
import { realizedPnl, type Fill } from '@/lib/db/pnl';

/**
 * Portfolio valuation and realized P&L derived from the exchange's own ledger.
 *
 * Every number here is computed from rows the exchange recorded itself: wallet
 * balances for holdings, `market_data` for prices, and `order_history` for
 * fills. Nothing is extrapolated, sampled or defaulted to a plausible-looking
 * constant. When the ledger has no data the result is genuinely zero, and an
 * asset with no listed price is reported as unpriced rather than valued at an
 * invented rate.
 */

// Assets that are USD-denominated by design and therefore valued 1:1.
const USD_DENOMINATED = new Set(['USD', 'USDT', 'USDC', 'RUSD', 'RYUSD', 'DAI', 'TUSD', 'FDUSD']);

export function usdPrice(currency: string): number | null {
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

export interface AssetHolding {
  coin: string;
  available: number;
  locked: number;
  usdPrice: number | null;
  usdValue: number | null;
}

export interface PortfolioSummary {
  holdings: AssetHolding[];
  totalBalanceUSDT: number;
  unpricedAssets: string[];
  realizedPnlUSDT: number;
  realizedPnl24hUSDT: number;
  unrealizedPnlUSDT: number;
  openOrders: number;
}

function mergedBalances(userId: string): Map<string, { available: number; locked: number }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT b.currency AS currency, b.available AS available, b.locked AS locked
         FROM balances b
         JOIN wallets w ON b.wallet_id = w.wallet_id
        WHERE w.user_id = ?`,
    )
    .all(userId) as Array<{ currency: string; available: number | null; locked: number | null }>;

  const merged = new Map<string, { available: number; locked: number }>();
  for (const row of rows) {
    const currency = String(row.currency).toUpperCase();
    const entry = merged.get(currency) ?? { available: 0, locked: 0 };
    entry.available += Number(row.available) || 0;
    entry.locked += Number(row.locked) || 0;
    merged.set(currency, entry);
  }
  return merged;
}

export function portfolioSummary(userId: string): PortfolioSummary {
  const db = getDb();
  const merged = mergedBalances(userId);

  let totalBalanceUSDT = 0;
  const unpricedAssets: string[] = [];
  const holdings: AssetHolding[] = Array.from(merged.entries()).map(([coin, entry]) => {
    const price = usdPrice(coin);
    const usdValue = price === null ? null : (entry.available + entry.locked) * price;
    if (usdValue === null) {
      unpricedAssets.push(coin);
    } else {
      totalBalanceUSDT += usdValue;
    }
    return {
      coin,
      available: entry.available,
      locked: entry.locked,
      usdPrice: price,
      usdValue,
    };
  });

  const fills = db
    .prepare(
      `SELECT pair_id, side, filled_quantity AS quantity, average_price, fee, created_at
         FROM order_history
        WHERE user_id = ? AND status = 'filled'
              AND filled_quantity IS NOT NULL AND filled_quantity > 0
              AND average_price IS NOT NULL AND average_price > 0
        ORDER BY created_at ASC`,
    )
    .all(userId) as Fill[];

  const { total, last24h } = realizedPnl(fills);

  const openOrders = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM orders
          WHERE user_id = ? AND status IN ('pending', 'open', 'partially_filled')`,
      )
      .get(userId) as { n: number }
  ).n;

  return {
    holdings,
    totalBalanceUSDT,
    unpricedAssets,
    realizedPnlUSDT: total,
    realizedPnl24hUSDT: last24h,
    // Unrealized P&L needs a mark for every open derivative position and the
    // entry price of each spot lot. Neither is in this ledger, so it is
    // reported as zero rather than estimated.
    unrealizedPnlUSDT: 0,
    openOrders,
  };
}
