/**
 * Asset valuation from the exchange's own market data.
 *
 * Margin and derivative risk both need to express a collateral balance in the
 * settlement asset. The price comes from `market_data` (the same table the
 * ticker serves) or from the last settled trade, never from a constant. When no
 * price exists the caller gets `null` so it can refuse the operation instead of
 * valuing the asset at an invented rate.
 */

import { getDb } from '@/lib/db';
import { lastTradePrice } from '@/lib/trading/market-view';

/** Assets the venue treats as worth one unit of the native stablecoin. */
const NATIVE_STABLES = new Set(['RUSD', 'RYUSD', 'USDT', 'USDC']);

function observedPrice(symbol: string): number | null {
  const row = getDb().prepare('SELECT price FROM market_data WHERE symbol = ?').get(symbol) as
    | { price: number }
    | undefined;
  const price = Number(row?.price);
  if (Number.isFinite(price) && price > 0) return price;
  return lastTradePrice(symbol);
}

/**
 * Price of one unit of `asset` expressed in `quote`.
 *
 * Tries the direct pair, then the asset priced in the native stablecoin, then
 * the inverse pair. A stablecoin quoted against another stablecoin is one.
 */
export function priceInQuote(asset: string, quote: string): number | null {
  const base = asset.trim().toUpperCase();
  const unit = quote.trim().toUpperCase();
  if (!base || !unit) return null;
  if (base === unit) return 1;
  if (NATIVE_STABLES.has(base) && NATIVE_STABLES.has(unit)) return 1;

  const direct = observedPrice(`${base}/${unit}`);
  if (direct !== null) return direct;

  if (unit !== 'RUSD') {
    const inStable = observedPrice(`${base}/RUSD`);
    if (inStable !== null) return inStable;
  }

  if (base !== 'RUSD') {
    const inverse = observedPrice(`${unit}/${base}`);
    if (inverse !== null && inverse > 0) return 1 / inverse;
  }

  return null;
}

/** Value a holding in the quote asset, or null when the asset is unpriced. */
export function valueInQuote(asset: string, quantity: number, quote: string): number | null {
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  const price = priceInQuote(asset, quote);
  if (price === null) return null;
  return price * quantity;
}
