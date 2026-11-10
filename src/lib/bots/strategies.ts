/**
 * Trading bot strategy math: grid, DCA/martingale, TWAP, smart rebalance and
 * the self-built market maker.
 *
 * The bot decides what orders to place; it never invents a fill. Every function
 * returns explicit orders or an error, so a misconfigured bot is refused at
 * start rather than left running with an empty or inverted range.
 */

export type BotStrategy =
  | 'spot_grid'
  | 'futures_grid'
  | 'dca'
  | 'martingale'
  | 'infinity_grid'
  | 'rebalance'
  | 'twap'
  | 'market_maker'
  | 'arbitrage';

export interface GridLevel {
  price: number;
  side: 'buy' | 'sell';
}

export interface GridConfig {
  lowerPrice: number;
  upperPrice: number;
  grids: number;
  /** Geometric spacing compounds; arithmetic spaces evenly in price. */
  geometric?: boolean;
}

/**
 * Build the price ladder for a grid bot.
 *
 * Arithmetic spacing is used by default; geometric spacing is offered for
 * wide ranges where equal price steps would be impractical. The level count
 * must be at least two and the bounds must be ordered.
 */
export function gridLevels(config: GridConfig): GridLevel[] | { error: string } {
  const { lowerPrice, upperPrice, grids } = config;
  if (!Number.isFinite(lowerPrice) || lowerPrice <= 0) return { error: 'lowerPrice must be positive' };
  if (!Number.isFinite(upperPrice) || upperPrice <= 0) return { error: 'upperPrice must be positive' };
  if (lowerPrice >= upperPrice) return { error: 'lowerPrice must be less than upperPrice' };
  if (!Number.isInteger(grids) || grids < 2) return { error: 'grids must be an integer of at least 2' };

  const levels: GridLevel[] = [];
  if (config.geometric) {
    const ratio = Math.pow(upperPrice / lowerPrice, 1 / grids);
    for (let i = 0; i <= grids; i += 1) {
      const price = lowerPrice * Math.pow(ratio, i);
      levels.push({ price, side: i === 0 ? 'buy' : i === grids ? 'sell' : 'buy' });
    }
  } else {
    const step = (upperPrice - lowerPrice) / grids;
    for (let i = 0; i <= grids; i += 1) {
      const price = lowerPrice + step * i;
      levels.push({ price, side: i === 0 ? 'buy' : i === grids ? 'sell' : 'buy' });
    }
  }
  return levels;
}

/**
 * Decide which grid order to place for the current price.
 *
 * Below the ladder's lower bound the bot buys the lowest level; above the
 * upper bound it sells the highest. Inside the ladder it targets the nearest
 * level, which is what produces the buy-low/sell-high behaviour.
 */
export function gridSignal(levels: GridLevel[], currentPrice: number): GridLevel | null {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const sorted = [...levels].sort((a, b) => a.price - b.price);
  if (currentPrice <= sorted[0].price) return { ...sorted[0], side: 'buy' };
  if (currentPrice >= sorted[sorted.length - 1].price) {
    return { ...sorted[sorted.length - 1], side: 'sell' };
  }

  let nearest = sorted[0];
  let best = Math.abs(sorted[0].price - currentPrice);
  for (const level of sorted) {
    const distance = Math.abs(level.price - currentPrice);
    if (distance < best) {
      best = distance;
      nearest = level;
    }
  }
  return { ...nearest, side: nearest.price < currentPrice ? 'buy' : 'sell' };
}

export interface DcaConfig {
  /** Amount invested per scheduled buy, in the quote asset. */
  amount: number;
  /** Interval between buys in nanoseconds. */
  intervalNs: number;
  /** Martingale multiplier applied to the amount after each buy. */
  multiplier?: number;
  /** Upper bound on the amount, so martingale cannot run away. */
  maxAmount?: number;
}

/**
 * Amount for the DCA buy at a given step index.
 *
 * A martingale multiplier grows the amount; it is capped at `maxAmount` so an
 * unbounded sequence cannot commit unlimited capital.
 */
export function dcaAmount(config: DcaConfig, stepIndex: number): number | { error: string } {
  if (!Number.isFinite(config.amount) || config.amount <= 0) {
    return { error: 'amount must be a positive number' };
  }
  if (!Number.isFinite(config.intervalNs) || config.intervalNs <= 0) {
    return { error: 'intervalNs must be a positive number' };
  }
  if (!Number.isInteger(stepIndex) || stepIndex < 0) return { error: 'stepIndex must be a non-negative integer' };

  const multiplier = config.multiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    return { error: 'multiplier must be at least 1' };
  }
  const cap = config.maxAmount ?? Infinity;
  return Math.min(config.amount * Math.pow(multiplier, stepIndex), cap);
}

export interface TwapConfig {
  /** Total quantity to execute. */
  totalQuantity: number;
  /** Number of slices. */
  slices: number;
}

/**
 * Split a TWAP order into equal child quantities.
 *
 * The slices are equal and the last slice absorbs the rounding remainder so
 * the sum is exactly the parent quantity. A zero or negative parent, or fewer
 * than two slices, is refused.
 */
export function twapSlices(config: TwapConfig): number[] | { error: string } {
  if (!Number.isFinite(config.totalQuantity) || config.totalQuantity <= 0) {
    return { error: 'totalQuantity must be a positive number' };
  }
  if (!Number.isInteger(config.slices) || config.slices < 2) {
    return { error: 'slices must be an integer of at least 2' };
  }
  const each = config.totalQuantity / config.slices;
  const slices = new Array(config.slices).fill(each);
  slices[slices.length - 1] = config.totalQuantity - each * (config.slices - 1);
  return slices;
}

export interface RebalanceConfig {
  /** Target weights per asset, summing to 1. */
  targets: Record<string, number>;
  /** Current holdings by asset. */
  holdings: Record<string, number>;
  /** Prices by asset in the quote currency. */
  prices: Record<string, number>;
  /** Skip trades smaller than this notional to avoid churn. */
  minTradeNotional?: number;
}

export interface RebalanceOrder {
  asset: string;
  side: 'buy' | 'sell';
  notional: number;
  quantity: number;
}

/**
 * Normalise a rebalance `targets` parameter into an asset-to-weight map.
 *
 * Accepts either a map (`{ BTC: 0.5, ETH: 0.5 }`) or an array of
 * `{ asset|token, weight }` entries, so both the API and the UI can express the
 * same intent. Weights are validated by the caller against the planner.
 */
export function normalizeTargets(raw: unknown): Record<string, number> {
  const targets: Record<string, number> = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const asset = String(record.asset ?? record.token ?? '').trim().toUpperCase();
      if (asset) targets[asset] = Number(record.weight);
    }
  } else if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const asset = key.trim().toUpperCase();
      if (asset) targets[asset] = Number(value);
    }
  }
  return targets;
}

/**
 * Compute the trades that move a portfolio to its target weights.
 *
 * Weights must be positive and sum to 1 (within a small tolerance). Assets with
 * no price cannot be valued, so the whole rebalance is refused rather than
 * silently skipping them and distorting the weights.
 */
export function rebalanceOrders(config: RebalanceConfig): RebalanceOrder[] | { error: string } {
  const { targets, holdings, prices } = config;
  const assets = Object.keys(targets);
  if (assets.length === 0) return { error: 'targets must not be empty' };

  const weightSum = assets.reduce((sum, a) => sum + targets[a], 0);
  if (Math.abs(weightSum - 1) > 1e-6) return { error: 'target weights must sum to 1' };

  for (const asset of assets) {
    if (!Number.isFinite(targets[asset]) || targets[asset] < 0) {
      return { error: `target weight for ${asset} must be non-negative` };
    }
    const price = prices[asset];
    if (!Number.isFinite(price) || price <= 0) {
      return { error: `price for ${asset} is missing or non-positive` };
    }
  }

  let totalValue = 0;
  for (const asset of assets) {
    const held = holdings[asset] ?? 0;
    if (!Number.isFinite(held) || held < 0) return { error: `holding for ${asset} must be non-negative` };
    totalValue += held * prices[asset];
  }
  if (totalValue <= 0) return { error: 'portfolio has no value to rebalance' };

  const minNotional = config.minTradeNotional ?? 0;
  const orders: RebalanceOrder[] = [];
  for (const asset of assets) {
    const held = holdings[asset] ?? 0;
    const targetValue = totalValue * targets[asset];
    const currentValue = held * prices[asset];
    const delta = targetValue - currentValue;
    if (Math.abs(delta) < minNotional) continue;
    orders.push({
      asset,
      side: delta > 0 ? 'buy' : 'sell',
      notional: Math.abs(delta),
      quantity: Math.abs(delta) / prices[asset],
    });
  }
  return orders;
}

export interface MarketMakerConfig {
  /** Half-spread from mid, as a fraction (0.001 = 0.1%). */
  spread: number;
  /** Notional to quote on each side. */
  depthPerSide: number;
  /** Inventory in base units; skews quotes to reduce it. */
  inventory: number;
  /** Inventory at which the skew reaches its maximum. */
  maxInventory: number;
}

export interface MarketMakerQuotes {
  bid: number;
  ask: number;
  bidNotional: number;
  askNotional: number;
}

/**
 * Quote a two-sided market around the mid price with inventory skew.
 *
 * A long inventory widens the bid and tightens the ask so the bot sells down;
 * a short inventory does the opposite. The spread must be positive and below
 * 1, and depth must be positive. The result is clamped so the bid never rises
 * above the ask.
 */
export function marketMakerQuotes(
  midPrice: number,
  config: MarketMakerConfig,
): MarketMakerQuotes | { error: string } {
  if (!Number.isFinite(midPrice) || midPrice <= 0) return { error: 'midPrice must be a positive number' };
  if (!Number.isFinite(config.spread) || config.spread <= 0 || config.spread >= 1) {
    return { error: 'spread must be a fraction in (0, 1)' };
  }
  if (!Number.isFinite(config.depthPerSide) || config.depthPerSide <= 0) {
    return { error: 'depthPerSide must be a positive number' };
  }
  if (!Number.isFinite(config.inventory) || !Number.isFinite(config.maxInventory) || config.maxInventory <= 0) {
    return { error: 'inventory and maxInventory must be finite, with maxInventory positive' };
  }

  const skew = Math.min(Math.max(config.inventory / config.maxInventory, -1), 1);
  const halfSpread = config.spread / 2;
  const bidPrice = midPrice * (1 - halfSpread - skew * halfSpread);
  const askPrice = midPrice * (1 + halfSpread - skew * halfSpread);

  const bid = Math.max(Math.min(bidPrice, askPrice), 0);
  const ask = Math.max(bid, askPrice);
  return {
    bid,
    ask,
    bidNotional: config.depthPerSide,
    askNotional: config.depthPerSide,
  };
}

export interface ArbitrageInput {
  /** Price of the asset on the spot leg. */
  spotPrice: number;
  /** Price of the same asset on the futures leg. */
  futuresPrice: number;
  /** Annualised funding rate of the futures leg. */
  fundingApr: number;
  /** Days the position is expected to be held. */
  holdDays: number;
  /** Round-trip fee as a fraction of notional. */
  feeRate: number;
}

export interface ArbitrageResult {
  /** Basis as a fraction of the spot price. */
  basis: number;
  fundingYield: number;
  netEdge: number;
  profitable: boolean;
}

/**
 * Evaluate a spot-versus-futures carry trade.
 *
 * The edge is the basis plus the funding received over the hold period, less
 * the round-trip fees. It is only profitable when that net edge is positive,
 * so a negative-funding or fee-dominated trade is refused rather than entered.
 */
export function arbitrageEdge(input: ArbitrageInput): ArbitrageResult | { error: string } {
  const { spotPrice, futuresPrice, fundingApr, holdDays, feeRate } = input;
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) return { error: 'spotPrice must be positive' };
  if (!Number.isFinite(futuresPrice) || futuresPrice <= 0) return { error: 'futuresPrice must be positive' };
  if (!Number.isFinite(fundingApr)) return { error: 'fundingApr must be finite' };
  if (!Number.isFinite(holdDays) || holdDays < 0) return { error: 'holdDays must be non-negative' };
  if (!Number.isFinite(feeRate) || feeRate < 0) return { error: 'feeRate must be non-negative' };

  const basis = (futuresPrice - spotPrice) / spotPrice;
  const fundingYield = fundingApr * (holdDays / 365);
  const netEdge = basis + fundingYield - feeRate;
  return { basis, fundingYield, netEdge, profitable: netEdge > 0 };
}
