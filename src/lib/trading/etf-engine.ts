/**
 * Leveraged-token (ETF) engine.
 *
 * A market is a row in `etf_markets` with a target leverage, a live NAV and the
 * price of its underlying at the last rebalance. Subscriptions mint tokens at
 * the current NAV and redemptions burn them at it; the daily rebalance restores
 * the target leverage by resetting NAV to the underlying move, which is what
 * keeps a 3x token tracking three times the daily return.
 *
 * The NAV maths is the pure `@/lib/trading/etf` model, so a token cannot go
 * negative and the rebalance drag is applied rather than assumed away.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';
import { debitAvailable, creditAvailable, recordTransaction } from '@/lib/db/ledger';
import { usdPrice } from '@/lib/db/portfolio';
import {
  applyMove,
  managementFee,
  redemptionValue,
  tokensForDeposit,
  DEFAULT_ETF_CONFIG,
  type EtfConfig,
} from '@/lib/trading/etf';
import { pausedScope, pauseMessage } from '@/lib/trading/controls';
import { recordRevenue } from '@/lib/trading/revenue';

export class EtfError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface EtfMarket {
  marketId: string;
  symbol: string;
  underlying: string;
  settlementAsset: string;
  leverage: number;
  direction: 'long' | 'short';
  nav: number;
  lastRebalanceNs: number | null;
  rebalanceThreshold: number;
  managementFeeApr: number;
  status: string;
}

function toMarket(row: Record<string, unknown>): EtfMarket {
  return {
    marketId: String(row.market_id),
    symbol: String(row.symbol),
    underlying: String(row.underlying),
    settlementAsset: String(row.settlement_asset),
    leverage: Number(row.leverage) || 1,
    direction: row.direction === 'short' ? 'short' : 'long',
    nav: Number(row.nav) || 0,
    lastRebalanceNs: row.last_rebalance_ns === null || row.last_rebalance_ns === undefined ? null : Number(row.last_rebalance_ns),
    rebalanceThreshold: Number(row.rebalance_threshold) || DEFAULT_ETF_CONFIG.rebalanceThreshold,
    managementFeeApr: Number(row.management_fee_apr) || DEFAULT_ETF_CONFIG.managementFeeApr,
    status: String(row.status),
  };
}

export function listEtfMarkets(): EtfMarket[] {
  const rows = getDb()
    .prepare("SELECT * FROM etf_markets WHERE status = 'active' ORDER BY underlying, leverage")
    .all() as Array<Record<string, unknown>>;
  return rows.map(toMarket);
}

export function getEtfMarket(symbol: string): EtfMarket | null {
  const row = getDb()
    .prepare('SELECT * FROM etf_markets WHERE symbol = ?')
    .get(symbol.trim().toUpperCase()) as Record<string, unknown> | undefined;
  return row ? toMarket(row) : null;
}

/** The effective leverage of a token: negative for an inverse market. */
export function effectiveLeverage(market: EtfMarket): number {
  return market.direction === 'short' ? -market.leverage : market.leverage;
}

function configFor(market: EtfMarket): EtfConfig {
  return { rebalanceThreshold: market.rebalanceThreshold, managementFeeApr: market.managementFeeApr };
}

export interface EtfQuote {
  symbol: string;
  nav: number;
  leverage: number;
  underlying: string;
  underlyingPrice: number;
  settlementAsset: string;
}

/** The live NAV of a market, marked against the underlying's current price. */
export function quoteToken(market: EtfMarket, nowMs: number = Date.now()): EtfQuote {
  const price = usdPrice(market.underlying);
  if (price === null || price <= 0) {
    throw new EtfError('NO_UNDERLYING_PRICE', `No observable price for ${market.underlying}`, 503);
  }
  const nav = currentNav(market, price, nowMs);
  return {
    symbol: market.symbol,
    nav,
    leverage: effectiveLeverage(market),
    underlying: market.underlying,
    underlyingPrice: price,
    settlementAsset: market.settlementAsset,
  };
}

/**
 * The market's NAV after applying the underlying move and the accrued
 * management fee since the last rebalance.
 *
 * A market that has never rebalanced has no reference price, so its stored NAV
 * is returned unchanged; there is no move to apply.
 */
function currentNav(market: EtfMarket, currentPrice: number, nowMs: number): number {
  if (market.lastRebalanceNs === null) return market.nav;

  const referencePrice = referencePriceFor(market);
  if (referencePrice === null || referencePrice <= 0) return market.nav;

  const moved = applyMove(
    {
      nav: market.nav,
      leverage: effectiveLeverage(market),
      lastRebalancePrice: referencePrice,
      lastRebalanceNs: market.lastRebalanceNs,
    },
    currentPrice,
  );
  if (typeof moved !== 'number') return market.nav;

  const elapsedNs = Math.max(0, nowMs * 1e6 - market.lastRebalanceNs);
  const fee = managementFee(moved, elapsedNs, configFor(market));
  return Math.max(moved - fee, 0);
}

/**
 * The underlying price at the market's last rebalance.
 *
 * It is recovered from the reference NAV: NAV is set equal to the underlying
 * price at rebalance, so the stored NAV at that instant is the reference price.
 */
function referencePriceFor(market: EtfMarket): number | null {
  const row = getDb()
    .prepare('SELECT reference_price FROM etf_markets WHERE market_id = ?')
    .get(market.marketId) as { reference_price: number | null } | undefined;
  const value = Number(row?.reference_price);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface EtfPositionView {
  positionId: string;
  symbol: string;
  underlying: string;
  tokens: number;
  costBasis: number;
  nav: number;
  marketValue: number;
  unrealizedPnl: number;
  updatedAt: string;
}

function toPosition(row: Record<string, unknown>, market: EtfMarket | null): EtfPositionView {
  const tokens = Number(row.tokens) || 0;
  const costBasis = Number(row.cost_basis) || 0;
  const nav = market ? market.nav : 0;
  return {
    positionId: String(row.position_id),
    symbol: String(row.symbol),
    underlying: market ? market.underlying : '',
    tokens,
    costBasis,
    nav,
    marketValue: tokens * nav,
    unrealizedPnl: tokens * nav - costBasis,
    updatedAt: String(row.updated_at),
  };
}

/** The caller's leveraged-token holdings, newest first. */
export function listPositions(userId: string): EtfPositionView[] {
  const rows = getDb()
    .prepare('SELECT * FROM etf_positions WHERE user_id = ? AND tokens > 0 ORDER BY updated_at DESC LIMIT 500')
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => toPosition(row, getEtfMarket(String(row.symbol))));
}

/** A user's holding in one market, or null. */
export function positionFor(userId: string, symbol: string): EtfPositionView | null {
  const row = getDb()
    .prepare('SELECT * FROM etf_positions WHERE user_id = ? AND symbol = ?')
    .get(userId, symbol.trim().toUpperCase()) as Record<string, unknown> | undefined;
  return row ? toPosition(row, getEtfMarket(symbol)) : null;
}

export interface SubscribeInput {
  userId: string;
  symbol: string;
  amount: number;
}

/**
 * Subscribe to a leveraged token.
 *
 * The settlement asset is debited and tokens are minted at the live NAV, so a
 * subscriber receives exactly what their deposit buys. The mint and the debit
 * run in one transaction.
 */
export function subscribe(input: SubscribeInput): EtfPositionView {
  const paused = pausedScope('etf');
  if (paused) throw new EtfError('TRADING_PAUSED', pauseMessage(paused), 409);
  const market = getEtfMarket(input.symbol);
  if (!market) throw new EtfError('UNKNOWN_TOKEN', `${input.symbol} is not a listed token`, 404);
  if (market.status !== 'active') throw new EtfError('TOKEN_INACTIVE', 'This token is not trading', 409);

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new EtfError('VALIDATION_FAILED', 'Amount must be positive');

  const quote = quoteToken(market);
  const tokens = tokensForDeposit(amount, quote.nav);
  if (tokens <= 0) throw new EtfError('AMOUNT_TOO_SMALL', 'The deposit buys no tokens at the current NAV');

  const db = getDb();
  db.transaction(() => {
    debitAvailable(input.userId, market.settlementAsset, amount);
    recordTransaction(input.userId, 'etf_subscribe', market.settlementAsset, amount, 0, 'completed', `subscribe ${tokens} ${market.symbol}`);

    const existing = db
      .prepare('SELECT position_id, tokens, cost_basis FROM etf_positions WHERE user_id = ? AND market_id = ?')
      .get(input.userId, market.marketId) as { position_id: string; tokens: number; cost_basis: number } | undefined;

    if (existing) {
      db.prepare(
        "UPDATE etf_positions SET tokens = tokens + ?, cost_basis = cost_basis + ?, updated_at = datetime('now') WHERE position_id = ?",
      ).run(tokens, amount, existing.position_id);
    } else {
      db.prepare(
        `INSERT INTO etf_positions (position_id, user_id, market_id, symbol, tokens, cost_basis)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(generateId(), input.userId, market.marketId, market.symbol, tokens, amount);
    }

    db.prepare(
      `INSERT INTO etf_trades (trade_id, user_id, market_id, symbol, action, tokens, nav, amount, fee)
       VALUES (?, ?, ?, ?, 'subscribe', ?, ?, ?, 0)`,
    ).run(generateId(), input.userId, market.marketId, market.symbol, tokens, quote.nav, amount);
  })();

  const position = positionFor(input.userId, market.symbol);
  if (!position) throw new EtfError('INTERNAL_ERROR', 'The subscription could not be recorded', 500);
  return position;
}

export interface RedeemInput {
  userId: string;
  symbol: string;
  tokens: number;
  exitFeeRate?: number;
}

/** Redeem leveraged tokens for the settlement asset at the live NAV. */
export function redeem(input: RedeemInput): { redeemed: number; proceeds: number; nav: number } {
  const market = getEtfMarket(input.symbol);
  if (!market) throw new EtfError('UNKNOWN_TOKEN', `${input.symbol} is not a listed token`, 404);

  const tokens = Number(input.tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) throw new EtfError('VALIDATION_FAILED', 'Token quantity must be positive');

  const db = getDb();
  const position = db
    .prepare('SELECT * FROM etf_positions WHERE user_id = ? AND market_id = ?')
    .get(input.userId, market.marketId) as Record<string, unknown> | undefined;
  if (!position) throw new EtfError('NO_POSITION', 'No position in this token', 404);

  const held = Number(position.tokens) || 0;
  if (tokens > held + 1e-12) throw new EtfError('INSUFFICIENT_TOKENS', 'You do not hold that many tokens');

  const quote = quoteToken(market);
  const exitFee = Number(input.exitFeeRate) || 0;
  const proceeds = redemptionValue(tokens, quote.nav, exitFee);
  const fee = tokens * quote.nav - proceeds;
  const costRemoved = held > 0 ? (Number(position.cost_basis) || 0) * (tokens / held) : 0;

  db.transaction(() => {
    creditAvailable(input.userId, market.settlementAsset, proceeds);
    recordTransaction(input.userId, 'etf_redeem', market.settlementAsset, proceeds, fee, 'completed', `redeem ${tokens} ${market.symbol}`);

    const remaining = held - tokens;
    if (remaining <= 1e-12) {
      db.prepare('UPDATE etf_positions SET tokens = 0, cost_basis = 0, updated_at = datetime(\'now\') WHERE position_id = ?')
        .run(position.position_id);
    } else {
      db.prepare('UPDATE etf_positions SET tokens = ?, cost_basis = MAX(cost_basis - ?, 0), updated_at = datetime(\'now\') WHERE position_id = ?')
        .run(remaining, costRemoved, position.position_id);
    }

    db.prepare(
      `INSERT INTO etf_trades (trade_id, user_id, market_id, symbol, action, tokens, nav, amount, fee)
       VALUES (?, ?, ?, ?, 'redeem', ?, ?, ?, ?)`,
    ).run(generateId(), input.userId, market.marketId, market.symbol, tokens, quote.nav, proceeds, fee);

    recordRevenue('etf_fee', market.settlementAsset, fee, input.userId, market.symbol);
  })();

  return { redeemed: tokens, proceeds, nav: quote.nav };
}

export interface RebalanceResult {
  symbol: string;
  rebalanced: boolean;
  nav: number;
  underlyingPrice: number | null;
}

/**
 * Rebalance one market if it is due.
 *
 * The rebalance resets NAV to the underlying's price (so the token starts the
 * next day at exactly the target leverage) and records the reference price. It
 * is idempotent: a market already at its reference price and within a day of
 * its last rebalance is left untouched.
 */
export function rebalanceMarket(market: EtfMarket, nowMs: number = Date.now()): RebalanceResult {
  const price = usdPrice(market.underlying);
  if (price === null || price <= 0) {
    return { symbol: market.symbol, rebalanced: false, nav: market.nav, underlyingPrice: null };
  }

  const nav = currentNav(market, price, nowMs);
  const dayNs = 24 * 60 * 60 * 1e9;
  const dueByTime = market.lastRebalanceNs === null || nowMs * 1e6 - market.lastRebalanceNs >= dayNs;
  const drift = market.nav > 0 ? Math.abs(nav - market.nav) / market.nav : 0;
  const dueByDrift = drift >= market.rebalanceThreshold;

  if (!dueByTime && !dueByDrift) {
    return { symbol: market.symbol, rebalanced: false, nav, underlyingPrice: price };
  }

  getDb()
    .prepare(
      `UPDATE etf_markets SET nav = ?, reference_price = ?, last_rebalance_ns = ? WHERE market_id = ?`,
    )
    .run(price, price, nowMs * 1e6, market.marketId);

  return { symbol: market.symbol, rebalanced: true, nav: price, underlyingPrice: price };
}

/** Rebalance every active market that is due. */
export function rebalanceAll(nowMs: number = Date.now()): RebalanceResult[] {
  return listEtfMarkets().map((market) => rebalanceMarket(market, nowMs));
}

/** The caller's leveraged-token subscription and redemption records. */
export function tradeHistory(userId: string, limit = 100): Array<Record<string, unknown>> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
  return getDb()
    .prepare('SELECT * FROM etf_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, bounded) as Array<Record<string, unknown>>;
}
