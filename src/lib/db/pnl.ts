/**
 * Realized P&L for a stream of fills, using the average-cost method per pair.
 *
 * Kept free of database and framework imports so the arithmetic can be tested
 * directly. See `portfolio.ts` for how fills are loaded from the ledger.
 */

export interface Fill {
  pair_id: string;
  side: string;
  quantity: number;
  average_price: number;
  fee: number;
  created_at: string;
}

export interface RealizedPnl {
  total: number;
  last24h: number;
}

interface Position {
  qty: number;
  cost: number; // total cost basis; negative while a short is open
}

/**
 * A buy adds to the position at the fill's average price. A sell realizes
 * (price - averageCost) * closedQuantity. Fees are always a cost, on both
 * sides. A sell larger than the open position realizes the closed part and
 * opens a short with the remainder, so shorting is handled symmetrically.
 *
 * Fills with a non-finite or non-positive quantity or price are ignored: an
 * unusable row must not silently distort the result.
 */
export function realizedPnl(fills: Fill[], now: number = Date.now()): RealizedPnl {
  const positions = new Map<string, Position>();
  let total = 0;
  let last24h = 0;
  const cutoff = now - 24 * 60 * 60 * 1000;

  for (const fill of fills) {
    const qty = Number(fill.quantity);
    const price = Number(fill.average_price);
    const fee = Number(fill.fee) || 0;
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) continue;

    const pos = positions.get(fill.pair_id) ?? { qty: 0, cost: 0 };
    const side = String(fill.side).toLowerCase();
    if (side !== 'buy' && side !== 'sell') continue;

    const signed = side === 'buy' ? qty : -qty;
    let realized = 0;

    if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signed)) {
      // Opening or extending a position does not realize anything.
      pos.qty += signed;
      pos.cost += signed * price;
    } else {
      // The fill reduces, closes or flips the open position.
      const direction = Math.sign(pos.qty); // +1 long, -1 short
      const entry = pos.cost / pos.qty; // per-unit cost basis
      const closed = Math.min(Math.abs(signed), Math.abs(pos.qty));
      realized = closed * (price - entry) * direction;
      pos.qty -= direction * closed;
      pos.cost -= direction * closed * entry;

      const remainder = Math.abs(signed) - closed;
      if (remainder > 0) {
        pos.qty = Math.sign(signed) * remainder;
        pos.cost = pos.qty * price;
      }
    }

    positions.set(fill.pair_id, pos);

    const net = realized - fee;
    total += net;
    const ts = Date.parse(String(fill.created_at).replace(' ', 'T') + 'Z');
    if (Number.isFinite(ts) && ts >= cutoff) last24h += net;
  }

  return { total, last24h };
}
