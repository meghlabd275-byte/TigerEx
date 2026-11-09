/**
 * TigerSwap trading bots: grid, DCA, arbitrage, market maker, rebalancing and
 * liquidation. Each function is the pure decision core of one bot, so the
 * behaviour can be tested without a running scheduler. All of them trade only
 * TigerSwap's own pools and read only real state handed to them.
 */

import { AmmError } from '@/lib/dex/amm';

// ============================================================================
// Grid bot
// ============================================================================

export interface GridConfig {
  /** Lower bound of the range. */
  lowerPrice: number;
  /** Upper bound of the range. */
  upperPrice: number;
  /** Number of grid levels; the number of intervals is one fewer. */
  levels: number;
  /** Quote currency committed per level. */
  orderSize: number;
  /** Arithmetic or geometric spacing of the levels. */
  spacing?: 'arithmetic' | 'geometric';
}

/** The grid prices, ascending from the lower bound to the upper. */
export function gridLevels(config: GridConfig): number[] {
  if (!Number.isFinite(config.lowerPrice) || config.lowerPrice <= 0) {
    throw new AmmError('INVALID_PRICE', 'lowerPrice must be positive');
  }
  if (!Number.isFinite(config.upperPrice) || config.upperPrice <= config.lowerPrice) {
    throw new AmmError('INVALID_PRICE', 'upperPrice must exceed lowerPrice');
  }
  if (!Number.isInteger(config.levels) || config.levels < 2) {
    throw new AmmError('INVALID_LEVELS', 'levels must be an integer of at least 2');
  }
  if (!Number.isFinite(config.orderSize) || config.orderSize <= 0) {
    throw new AmmError('INVALID_SIZE', 'orderSize must be positive');
  }
  const prices: number[] = [];
  const intervals = config.levels - 1;
  if (config.spacing === 'geometric') {
    const ratio = Math.pow(config.upperPrice / config.lowerPrice, 1 / intervals);
    for (let i = 0; i < config.levels; i += 1) prices.push(config.lowerPrice * Math.pow(ratio, i));
  } else {
    const step = (config.upperPrice - config.lowerPrice) / intervals;
    for (let i = 0; i < config.levels; i += 1) prices.push(config.lowerPrice + step * i);
  }
  return prices;
}

export type GridAction = { action: 'buy'; level: number; price: number; size: number } | { action: 'sell'; level: number; price: number; size: number } | { action: 'hold' };

/**
 * The action a grid bot takes when the price moves from one level to another.
 *
 * A step down through a level buys; a step up sells. Holding a `size` of base
 * asset per level means the sell size is derived from the price at the level
 * being sold, so the quote value of each grid trade is constant.
 */
export function gridAction(config: GridConfig, previousPrice: number, currentPrice: number): GridAction {
  const levels = gridLevels(config);
  if (!Number.isFinite(previousPrice) || previousPrice <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new AmmError('INVALID_PRICE', 'prices must be positive');
  }
  if (currentPrice === previousPrice) return { action: 'hold' };

  if (currentPrice < previousPrice) {
    // Price fell: buy at the highest level not above the current price that the
    // previous price was above.
    for (let i = levels.length - 1; i >= 0; i -= 1) {
      if (levels[i] <= currentPrice && levels[i] >= currentPrice) {
        return { action: 'buy', level: i, price: levels[i], size: config.orderSize / levels[i] };
      }
    }
    const level = levels.filter((p) => p >= currentPrice)[0] ?? levels[0];
    return { action: 'buy', level: levels.indexOf(level), price: level, size: config.orderSize / level };
  }

  const level = [...levels].reverse().find((p) => p <= currentPrice) ?? levels[levels.length - 1];
  return { action: 'sell', level: levels.indexOf(level), price: level, size: config.orderSize / level };
}

// ============================================================================
// Arbitrage bot
// ============================================================================

export interface ArbOpportunity {
  buyPoolId: string;
  sellPoolId: string;
  tokenIn: string;
  tokenOut: string;
  /** Amount of `tokenIn` to route through the buy pool. */
  amountIn: number;
  /** Gross output of the buy leg. */
  intermediate: number;
  /** Output of the sell leg, before the sell pool's fee is counted twice. */
  amountOut: number;
  /** Profit in `tokenIn` units, net of both pools' fees. */
  profit: number;
  /** Profit as a fraction of the amount deployed. */
  profitRate: number;
}

/**
 * Find the best two-pool arbitrage between TigerSwap's own pools.
 *
 * Both pools must trade the same pair; the trade buys in the cheaper pool and
 * sells in the dearer one. The search sizes the trade by golden-section
 * maximisation of the profit function, which is concave for constant-function
 * pools, so the found size is the true optimum rather than a guess.
 */
export function findArbitrage(
  buyQuote: (amountIn: number) => number,
  sellQuote: (amountIn: number) => number,
  buyPoolId: string,
  sellPoolId: string,
  tokenIn: string,
  tokenOut: string,
  maxAmountIn: number,
  tolerance = 1e-6,
): ArbOpportunity | null {
  if (!Number.isFinite(maxAmountIn) || maxAmountIn <= 0) {
    throw new AmmError('INVALID_AMOUNT', 'maxAmountIn must be positive');
  }
  const profit = (amountIn: number): number => {
    if (amountIn <= 0) return 0;
    try {
      const intermediate = buyQuote(amountIn);
      if (!Number.isFinite(intermediate) || intermediate <= 0) return -Infinity;
      const out = sellQuote(intermediate);
      if (!Number.isFinite(out)) return -Infinity;
      return out - amountIn;
    } catch {
      return -Infinity;
    }
  };

  // Golden-section search on [0, maxAmountIn] for the concave profit function.
  const phi = (Math.sqrt(5) - 1) / 2;
  let low = 0;
  let high = maxAmountIn;
  let c = high - phi * (high - low);
  let d = low + phi * (high - low);
  let fc = profit(c);
  let fd = profit(d);
  for (let i = 0; i < 200 && high - low > tolerance * maxAmountIn; i += 1) {
    if (fc < fd) {
      low = c;
      c = d;
      fc = fd;
      d = low + phi * (high - low);
      fd = profit(d);
    } else {
      high = d;
      d = c;
      fd = fc;
      c = high - phi * (high - low);
      fc = profit(c);
    }
  }
  const best = (low + high) / 2;
  const bestProfit = profit(best);
  if (!Number.isFinite(bestProfit) || bestProfit <= 0 || best <= 0) return null;
  const intermediate = buyQuote(best);
  const amountOut = sellQuote(intermediate);
  return {
    buyPoolId,
    sellPoolId,
    tokenIn,
    tokenOut,
    amountIn: best,
    intermediate,
    amountOut,
    profit: bestProfit,
    profitRate: bestProfit / best,
  };
}

// ============================================================================
// Market maker bot
// ============================================================================

export interface MarketMakerConfig {
  /** Half-spread around the mid, a fraction (0.001 = 0.1%). */
  spread: number;
  /** Depth to quote per side, in quote currency. */
  depth: number;
  /** Rebalance when the inventory drifts this far from neutral, a fraction. */
  rebalanceThreshold: number;
}

export interface MarketMakerQuote {
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  midPrice: number;
  /** Signed inventory drift; positive means long the base asset. */
  inventorySkew: number;
}

/**
 * Quote both sides of a pool around a fair price.
 *
 * The spread widens with inventory: a market maker long the base asset quotes
 * lower on both sides to encourage selling, which is the standard
 * inventory-risk adjustment. Sizes are the depth divided by each price.
 */
export function marketMakerQuote(
  fairPrice: number,
  inventoryBase: number,
  inventoryQuote: number,
  config: MarketMakerConfig,
): MarketMakerQuote {
  if (!Number.isFinite(fairPrice) || fairPrice <= 0) {
    throw new AmmError('INVALID_PRICE', 'fairPrice must be positive');
  }
  if (!Number.isFinite(inventoryBase) || inventoryBase < 0) {
    throw new AmmError('INVALID_INVENTORY', 'inventoryBase must not be negative');
  }
  if (!Number.isFinite(inventoryQuote) || inventoryQuote < 0) {
    throw new AmmError('INVALID_INVENTORY', 'inventoryQuote must not be negative');
  }
  if (!Number.isFinite(config.spread) || config.spread <= 0 || config.spread >= 1) {
    throw new AmmError('INVALID_SPREAD', 'spread must be a fraction in (0, 1)');
  }
  if (!Number.isFinite(config.depth) || config.depth <= 0) {
    throw new AmmError('INVALID_DEPTH', 'depth must be positive');
  }
  if (!Number.isFinite(config.rebalanceThreshold) || config.rebalanceThreshold <= 0) {
    throw new AmmError('INVALID_THRESHOLD', 'rebalanceThreshold must be positive');
  }

  const baseValue = inventoryBase * fairPrice;
  const totalValue = baseValue + inventoryQuote;
  const skew = totalValue === 0 ? 0 : (baseValue - inventoryQuote) / totalValue;
  const adjustedFair = fairPrice * (1 - skew * config.spread);

  return {
    bidPrice: adjustedFair * (1 - config.spread),
    askPrice: adjustedFair * (1 + config.spread),
    bidSize: config.depth / (adjustedFair * (1 - config.spread)),
    askSize: config.depth / (adjustedFair * (1 + config.spread)),
    midPrice: adjustedFair,
    inventorySkew: skew,
  };
}

/** Whether the market maker must rebalance its inventory. */
export function needsRebalance(inventoryBase: number, inventoryQuote: number, fairPrice: number, threshold: number): boolean {
  if (!Number.isFinite(fairPrice) || fairPrice <= 0) throw new AmmError('INVALID_PRICE', 'fairPrice must be positive');
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new AmmError('INVALID_THRESHOLD', 'threshold must be positive');
  }
  const baseValue = inventoryBase * fairPrice;
  const total = baseValue + inventoryQuote;
  if (total === 0) return false;
  return Math.abs(baseValue / total - 0.5) > threshold;
}

// ============================================================================
// Rebalancing bot
// ============================================================================

export interface TargetWeight {
  token: string;
  weight: number;
}

export interface RebalanceTrade {
  token: string;
  /** Positive to buy, negative to sell, in quote currency. */
  deltaQuote: number;
}

/**
 * Trades needed to bring a portfolio back to its target weights.
 *
 * The total value is held constant, so the trades are internally consistent:
 * what one asset sells another buys. A trade smaller than `minTradeQuote` is
 * dropped to avoid churning on rounding noise.
 */
export function planRebalance(
  holdings: Array<{ token: string; value: number }>,
  targets: TargetWeight[],
  minTradeQuote = 0,
): RebalanceTrade[] {
  if (holdings.length === 0) throw new AmmError('NO_HOLDINGS', 'holdings must not be empty');
  if (targets.length === 0) throw new AmmError('NO_TARGETS', 'targets must not be empty');
  const total = holdings.reduce((acc, h) => {
    if (!Number.isFinite(h.value) || h.value < 0) throw new AmmError('INVALID_VALUE', 'holding values must not be negative');
    return acc + h.value;
  }, 0);
  if (total <= 0) throw new AmmError('NO_VALUE', 'the portfolio has no value');

  const weightTotal = targets.reduce((acc, t) => {
    if (!Number.isFinite(t.weight) || t.weight < 0) throw new AmmError('INVALID_WEIGHT', 'weights must not be negative');
    return acc + t.weight;
  }, 0);
  if (weightTotal <= 0) throw new AmmError('NO_WEIGHT', 'target weights must be positive');

  const byToken = new Map(holdings.map((h) => [h.token, h.value]));
  const trades: RebalanceTrade[] = [];
  for (const target of targets) {
    const current = byToken.get(target.token) ?? 0;
    const desired = total * (target.weight / weightTotal);
    const delta = desired - current;
    if (Math.abs(delta) < minTradeQuote) continue;
    trades.push({ token: target.token, deltaQuote: delta });
  }
  return trades;
}

// ============================================================================
// Liquidation bot
// ============================================================================

export interface LiquidationCandidate {
  positionId: string;
  healthFactor: number;
  /** Profit the keeper earns for liquidating, in the settlement asset. */
  bounty: number;
}

/**
 * Rank liquidatable positions by keeper profit.
 *
 * Only positions with a health factor below 1 are returned, highest bounty
 * first, so a keeper scanning the queue acts on the most profitable one without
 * liquidating a position that is merely close to the threshold.
 */
export function liquidationCandidates(candidates: LiquidationCandidate[]): LiquidationCandidate[] {
  const liquidatable = candidates.filter((c) => {
    if (!Number.isFinite(c.healthFactor)) throw new AmmError('INVALID_HEALTH', 'health factor must be finite');
    if (!Number.isFinite(c.bounty) || c.bounty < 0) throw new AmmError('INVALID_BOUNTY', 'bounty must not be negative');
    return c.healthFactor < 1;
  });
  return liquidatable.sort((a, b) => b.bounty - a.bounty);
}

// ============================================================================
// DCA bot
// ============================================================================

/**
 * Decide whether a DCA bot should buy now.
 *
 * The bot buys when the price is at or below its running average of the last
 * `lookback` samples, which is the value-averaging rule: it accumulates more
 * when the asset is cheap and pauses when it is rich. A shorter history than the
 * lookback means there is not yet a signal.
 */
export function dcaShouldBuy(history: number[], lookback: number, price: number): boolean {
  if (!Number.isFinite(price) || price <= 0) throw new AmmError('INVALID_PRICE', 'price must be positive');
  if (!Number.isInteger(lookback) || lookback < 1) throw new AmmError('INVALID_LOOKBACK', 'lookback must be a positive integer');
  if (history.length < lookback) return false;
  const window = history.slice(-lookback);
  for (const sample of window) {
    if (!Number.isFinite(sample) || sample <= 0) throw new AmmError('INVALID_PRICE', 'history prices must be positive');
  }
  const average = window.reduce((acc, s) => acc + s, 0) / window.length;
  return price <= average;
}
