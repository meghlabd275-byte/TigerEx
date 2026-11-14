/**
 * Self-hosted venue market maker.
 *
 * A CEX with no external liquidity needs the venue itself to quote a two-sided
 * market so that a taker always has a counterparty. This module runs that
 * desk: for each opted-in market it quotes a post-only bid and ask around the
 * observed mid price, funded from a dedicated treasury inventory account.
 *
 * It never mirrors another exchange and never invents a price. The mid comes
 * from the venue's own book (or its own last trade), the quotes are real orders
 * that reserve real inventory through the spot engine, and a fill settles both
 * legs against that inventory exactly like any other trade. When the desk's
 * inventory or quote-currency balance cannot fund a quote, the quote is skipped
 * with a reason rather than fabricated.
 *
 * A market is enabled by an operator, one row in `market_maker_config`. The
 * desk is idempotent per (market, side, price): a scheduler running every second
 * only replaces a quote whose price has moved, so it never stacks duplicate
 * orders on the book.
 */

import { getDb, generateId, hashPassword } from '@/lib/db';
import { placeSpotOrder, cancelSpotOrder, SpotError } from '@/lib/trading/spot-engine';
import { lastTradePrice } from '@/lib/trading/market-view';
import { availableBalance, lockedBalance, creditAvailable } from '@/lib/db/ledger';
import { marketMakerQuotes } from '@/lib/bots/strategies';
import { pausedScope } from '@/lib/trading/controls';

export class MarketMakerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const DESK_EMAIL = 'market-maker-desk@tigerex.internal';
const INVENTORY_ACCOUNT = 'mm_inventory';

export interface MarketMakerConfig {
  symbol: string;
  enabled: boolean;
  spread: number;
  quoteQuantity: number;
  maxInventory: number;
  targetInventory: number;
  maxDeviation: number;
  targetPrice: number | null;
  updatedAt: string | null;
}

export interface MarketMakerTick {
  symbol: string;
  action: 'quoted' | 'skipped';
  reason?: string;
  bid?: number | null;
  ask?: number | null;
  inventory: number;
}

export interface MarketMakerStatus {
  symbol: string;
  enabled: boolean;
  spread: number;
  quoteQuantity: number;
  maxInventory: number;
  targetInventory: number;
  maxDeviation: number;
  base: string;
  quote: string;
  inventory: number;
  quoteBalance: number;
  midPrice: number | null;
  restingQuotes: { bid: number | null; ask: number | null };
}

/** The desk's single account, created once and reused. */
function deskUserId(): string {
  const db = getDb();
  const existing = db.prepare('SELECT user_id FROM users WHERE email = ?').get(DESK_EMAIL) as
    | { user_id: string }
    | undefined;
  if (existing) return existing.user_id;

  const userId = generateId();
  // The desk never authenticates interactively; its password is a random value
  // that is never disclosed, so the account cannot be signed into. It is marked
  // as a system account so it is excluded from user statistics.
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, username, display_name, status, kyc_level, kyc_status, is_system)
     VALUES (?, ?, ?, ?, 'Market Maker Desk', 'active', 'verified', 'verified', 1)`,
  ).run(userId, DESK_EMAIL, hashPassword(generateId() + generateId()), 'market_maker_desk');
  return userId;
}

function readConfig(symbol: string): MarketMakerConfig | null {
  const row = getDb()
    .prepare(
      `SELECT symbol, enabled, spread, quote_quantity, max_inventory, target_inventory, max_deviation, target_price, updated_at
         FROM market_maker_config WHERE symbol = ?`,
    )
    .get(symbol) as Record<string, unknown> | undefined;
  if (!row) return null;
  const targetPrice = Number(row.target_price);
  return {
    symbol: String(row.symbol),
    enabled: Number(row.enabled) === 1,
    spread: Number(row.spread),
    quoteQuantity: Number(row.quote_quantity),
    maxInventory: Number(row.max_inventory),
    targetInventory: Number(row.target_inventory),
    maxDeviation: Number(row.max_deviation),
    targetPrice: Number.isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null,
    updatedAt: row.updated_at === null || row.updated_at === undefined ? null : String(row.updated_at),
  };
}

function listConfigs(): MarketMakerConfig[] {
  const rows = getDb().prepare('SELECT symbol FROM market_maker_config').all() as Array<{ symbol: string }>;
  return rows.map((row) => readConfig(row.symbol)).filter((config): config is MarketMakerConfig => config !== null);
}

function pairFor(symbol: string): { base: string; quote: string; tickSize: number } {
  const row = getDb()
    .prepare('SELECT base_currency, quote_currency, tick_size FROM trading_pairs WHERE symbol = ? AND status = ?')
    .get(symbol, 'active') as { base_currency: string; quote_currency: string; tick_size: number } | undefined;
  if (!row) throw new MarketMakerError('UNKNOWN_MARKET', `No active market for ${symbol}`, 404);
  const tickSize = Number(row.tick_size);
  if (!Number.isFinite(tickSize) || tickSize <= 0) {
    throw new MarketMakerError('MARKET_TICK_INVALID', `Market ${symbol} has no valid tick size`, 500);
  }
  return { base: row.base_currency, quote: row.quote_currency, tickSize };
}

/**
 * Round a price to a multiple of the market's tick size.
 *
 * A quote must rest on a valid tick or the engine refuses it. The bid is
 * rounded down and the ask up, so the rounding can only widen the spread and
 * never turn a post-only quote into a crossing one.
 */
function roundToTick(price: number, tickSize: number, direction: 'down' | 'up'): number {
  const ticks = price / tickSize;
  const rounded = direction === 'down' ? Math.floor(ticks + 1e-9) : Math.ceil(ticks - 1e-9);
  const value = rounded * tickSize;
  // Trim floating-point dust from the multiplication.
  const decimals = Math.max(0, Math.ceil(-Math.log10(tickSize)));
  return Number(value.toFixed(decimals));
}

/**
 * The desk's current inventory of the base asset for a market: the balance it
 * holds plus whatever is reserved against its own resting quotes, so a quote
 * that has not filled still counts toward the desk's exposure.
 */
export function deskInventory(symbol: string): number {
  const { base } = pairFor(symbol);
  const userId = deskUserId();
  return availableBalance(userId, base) + lockedBalance(userId, base);
}

/**
 * The mid price of the book excluding the desk's own resting orders.
 *
 * The desk must not price off its own quotes, or each cycle would chase the
 * last one and the spread would walk away. Only other participants' orders
 * count, so the desk quotes around the price the rest of the market is showing.
 */
function externalMid(symbol: string, excludeUserId: string): number | null {
  const rows = getDb()
    .prepare(
      `SELECT o.side, o.price FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE p.symbol = ? AND o.user_id <> ? AND o.status IN ('open', 'partial')
          AND o.price IS NOT NULL AND o.remaining_quantity > 0`,
    )
    .all(symbol, excludeUserId) as Array<{ side: string; price: number }>;
  let bestBid = 0;
  let bestAsk = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (row.side === 'buy') bestBid = Math.max(bestBid, price);
    else bestAsk = Math.min(bestAsk, price);
  }
  if (bestBid > 0 && Number.isFinite(bestAsk)) return (bestBid + bestAsk) / 2;
  if (bestBid > 0) return bestBid;
  if (Number.isFinite(bestAsk)) return bestAsk;
  return null;
}

/**
 * The reference price for a market: the last trade, else the operator's anchor,
 * else the mid of other participants' orders.
 *
 * The desk never prices off its own quotes (see `externalMid`), and it never
 * invents a price: a market with no trade, no anchor and no external order is
 * skipped rather than quoted at a made-up number.
 */
function referencePrice(symbol: string, anchorPrice: number | null, excludeUserId: string): number | null {
  const last = lastTradePrice(symbol);
  if (last !== null && last > 0) return last;
  if (anchorPrice !== null && anchorPrice > 0) return anchorPrice;
  return externalMid(symbol, excludeUserId);
}

/** Existing resting quotes for the desk on one side of a market. */
function restingQuotes(symbol: string): { bid: number | null; ask: number | null } {
  const rows = getDb()
    .prepare(
      `SELECT o.side, o.price FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE o.user_id = ? AND p.symbol = ? AND o.status IN ('open', 'partial')`,
    )
    .all(deskUserId(), symbol) as Array<{ side: string; price: number | null }>;
  let bid: number | null = null;
  let ask: number | null = null;
  for (const row of rows) {
    if (row.price === null) continue;
    const price = Number(row.price);
    if (row.side === 'buy') bid = price;
    else ask = price;
  }
  return { bid, ask };
}

function cancelQuotes(symbol: string, userId: string): void {
  const rows = getDb()
    .prepare(
      `SELECT o.order_id FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE o.user_id = ? AND p.symbol = ? AND o.status IN ('open', 'partial')`,
    )
    .all(userId, symbol) as Array<{ order_id: string }>;
  for (const row of rows) {
    try {
      cancelSpotOrder(userId, row.order_id);
    } catch {
      // A quote already terminal needs no action.
    }
  }
}

/** Cancel the desk's resting quotes on one side of a market. */
function cancelSide(symbol: string, userId: string, side: 'buy' | 'sell'): void {
  const rows = getDb()
    .prepare(
      `SELECT o.order_id FROM orders o JOIN trading_pairs p ON p.pair_id = o.pair_id
        WHERE o.user_id = ? AND p.symbol = ? AND o.side = ? AND o.status IN ('open', 'partial')`,
    )
    .all(userId, symbol, side) as Array<{ order_id: string }>;
  for (const row of rows) {
    try {
      cancelSpotOrder(userId, row.order_id);
    } catch {
      // Already terminal.
    }
  }
}

/**
 * Run one quoting cycle for a single market.
 *
 * The desk quotes a bid and an ask around the mid, sized to `quoteQuantity`.
 * A quote is replaced when the price it would rest at differs from the one
 * already resting, and skipped when it is already at that price (so a
 * per-second scheduler is idempotent). A buy quote is skipped when the quote
 * balance cannot fund it; a sell quote is skipped when the inventory would
 * breach the desk's cap.
 */
export function runMarketMakerForSymbol(symbol: string, nowMs = Date.now()): MarketMakerTick {
  const config = readConfig(symbol);
  if (!config) return { symbol, action: 'skipped', reason: 'market maker is not configured for this market', inventory: 0 };
  if (!config.enabled) return { symbol, action: 'skipped', reason: 'market maker is disabled for this market', inventory: 0 };
  if (pausedScope('trading', 'spot', 'futures')) {
    return { symbol, action: 'skipped', reason: 'trading is paused', inventory: 0 };
  }

  const { base, quote, tickSize } = pairFor(symbol);
  const userId = deskUserId();
  // Total inventory includes what is reserved against the desk's own resting
  // quotes, so a quote that has not filled still counts toward its exposure.
  const inventory = availableBalance(userId, base) + lockedBalance(userId, base);
  const mid = referencePrice(symbol, config.targetPrice, userId);
  if (mid === null) {
    return { symbol, action: 'skipped', reason: 'no observable price', inventory };
  }

  // Guard against quoting into a broken market: refuse to quote when the mid
  // deviates more than the configured band from the desk's anchor price. The
  // anchor is only enforced once the venue has its own price to compare against
  // (a trade or another participant's order); before then the anchor is the
  // reference itself.
  if (config.targetPrice !== null && config.targetPrice > 0) {
    const observed = lastTradePrice(symbol) ?? externalMid(symbol, userId);
    if (observed !== null && observed > 0) {
      const deviation = Math.abs(observed - config.targetPrice) / config.targetPrice;
      if (deviation > config.maxDeviation) {
        // Cancel any stale quotes so the desk is not exposed in a moved market.
        cancelQuotes(symbol, userId);
        return {
          symbol,
          action: 'skipped',
          reason: `mid deviates ${(deviation * 100).toFixed(2)}% from target`,
          inventory,
        };
      }
    }
  }

  const raw = marketMakerQuotes(mid, {
    spread: config.spread,
    depthPerSide: config.quoteQuantity,
    inventory: inventory - config.targetInventory,
    maxInventory: config.maxInventory,
  });
  if ('error' in raw) {
    return { symbol, action: 'skipped', reason: raw.error, inventory };
  }

  // Quotes must rest on a valid tick; the bid rounds down and the ask up so the
  // rounding can only widen the spread.
  const quotes = {
    bid: roundToTick(raw.bid, tickSize, 'down'),
    ask: roundToTick(raw.ask, tickSize, 'up'),
  };
  if (quotes.bid <= 0 || quotes.ask <= quotes.bid) {
    return { symbol, action: 'skipped', reason: 'no valid tick for the computed quotes', inventory };
  }

  const existing = restingQuotes(symbol);

  // A sell quote would push inventory past the cap; the desk stops offering.
  const canSell = inventory >= config.quoteQuantity && inventory <= config.maxInventory;
  // A buy quote needs the quote balance to fund it.
  const quoteBalance = availableBalance(userId, quote);
  const canBuy = quoteBalance >= quotes.bid * config.quoteQuantity;

  // A resting quote is stale when the desk can no longer honour it, or when its
  // price no longer matches the freshly computed one. A stale quote is
  // withdrawn before the new one is placed so the book never shows a quote the
  // desk cannot honour.
  const staleBid = existing.bid !== null && (!canBuy || Math.abs(existing.bid - quotes.bid) > 1e-9);
  const staleAsk = existing.ask !== null && (!canSell || Math.abs(existing.ask - quotes.ask) > 1e-9);
  if (staleBid) cancelSide(symbol, userId, 'buy');
  if (staleAsk) cancelSide(symbol, userId, 'sell');

  let placed = false;
  if (canBuy && quotes.bid > 0 && (existing.bid === null || staleBid)) {
    try {
      placeSpotOrder(userId, {
        symbol,
        side: 'buy',
        type: 'limit',
        price: quotes.bid,
        quantity: config.quoteQuantity,
        postOnly: true,
      });
      placed = true;
    } catch (error) {
      if (!(error instanceof SpotError)) throw error;
    }
  }

  if (canSell && quotes.ask > 0 && (existing.ask === null || staleAsk)) {
    try {
      placeSpotOrder(userId, {
        symbol,
        side: 'sell',
        type: 'limit',
        price: quotes.ask,
        quantity: config.quoteQuantity,
        postOnly: true,
      });
      placed = true;
    } catch (error) {
      if (!(error instanceof SpotError)) throw error;
    }
  }

  return {
    symbol,
    action: placed ? 'quoted' : 'skipped',
    reason: placed ? undefined : 'quotes already resting at these prices',
    bid: quotes.bid,
    ask: quotes.ask,
    inventory,
  };
}

/** Run a quoting cycle for every enabled market. */
export function runMarketMakerCycle(): MarketMakerTick[] {
  const ticks: MarketMakerTick[] = [];
  for (const config of listConfigs()) {
    try {
      ticks.push(runMarketMakerForSymbol(config.symbol));
    } catch (error) {
      ticks.push({
        symbol: config.symbol,
        action: 'skipped',
        reason: error instanceof Error ? error.message : 'market maker cycle failed',
        inventory: 0,
      });
    }
  }
  return ticks;
}

/** Status for the admin console, including the desk's live inventory. */
export function marketMakerStatus(): MarketMakerStatus[] {
  return listConfigs().map((config) => {
    let base = '';
    let quote = '';
    let inventory = 0;
    let quoteBalance = 0;
    let mid: number | null = null;
    let resting = { bid: null as number | null, ask: null as number | null };
    try {
      const pair = pairFor(config.symbol);
      base = pair.base;
      quote = pair.quote;
      const userId = deskUserId();
      inventory = availableBalance(userId, base) + lockedBalance(userId, base);
      quoteBalance = availableBalance(userId, quote) + lockedBalance(userId, quote);
      mid = referencePrice(config.symbol, config.targetPrice, userId);
      resting = restingQuotes(config.symbol);
    } catch {
      // A market whose pair is gone still reports its configuration.
    }
    return {
      symbol: config.symbol,
      enabled: config.enabled,
      spread: config.spread,
      quoteQuantity: config.quoteQuantity,
      maxInventory: config.maxInventory,
      targetInventory: config.targetInventory,
      maxDeviation: config.maxDeviation,
      base,
      quote,
      inventory,
      quoteBalance,
      midPrice: mid,
      restingQuotes: resting,
    };
  });
}

/**
 * Enable, disable or retune the desk for a market.
 *
 * `targetPrice` anchors the deviation guard: the desk refuses to quote when the
 * market mid strays more than `maxDeviation` from it. It is set by the operator,
 * not invented, so a market with no anchor has no deviation guard.
 */
export function setMarketMakerConfig(input: {
  symbol: string;
  enabled: boolean;
  spread: number;
  quoteQuantity: number;
  maxInventory: number;
  targetInventory?: number;
  maxDeviation?: number;
  targetPrice?: number | null;
}): MarketMakerConfig {
  const symbol = String(input.symbol ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(symbol)) {
    throw new MarketMakerError('VALIDATION_FAILED', 'symbol must be of the form BASE/QUOTE');
  }
  // The market must exist and be active; the desk quotes a real market.
  pairFor(symbol);

  const spread = Number(input.spread);
  if (!Number.isFinite(spread) || spread <= 0 || spread >= 1) {
    throw new MarketMakerError('VALIDATION_FAILED', 'spread must be a fraction in (0, 1)');
  }
  const quoteQuantity = Number(input.quoteQuantity);
  if (!Number.isFinite(quoteQuantity) || quoteQuantity <= 0) {
    throw new MarketMakerError('VALIDATION_FAILED', 'quoteQuantity must be positive');
  }
  const maxInventory = Number(input.maxInventory);
  if (!Number.isFinite(maxInventory) || maxInventory <= 0) {
    throw new MarketMakerError('VALIDATION_FAILED', 'maxInventory must be positive');
  }
  const targetInventory = input.targetInventory === undefined ? 0 : Number(input.targetInventory);
  if (!Number.isFinite(targetInventory) || Math.abs(targetInventory) > maxInventory) {
    throw new MarketMakerError('VALIDATION_FAILED', 'targetInventory must be within [-maxInventory, maxInventory]');
  }
  const maxDeviation = input.maxDeviation === undefined ? 0.1 : Number(input.maxDeviation);
  if (!Number.isFinite(maxDeviation) || maxDeviation <= 0 || maxDeviation >= 1) {
    throw new MarketMakerError('VALIDATION_FAILED', 'maxDeviation must be a fraction in (0, 1)');
  }
  const targetPrice =
    input.targetPrice === undefined || input.targetPrice === null ? null : Number(input.targetPrice);
  if (targetPrice !== null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
    throw new MarketMakerError('VALIDATION_FAILED', 'targetPrice must be positive when set');
  }

  getDb()
    .prepare(
      `INSERT INTO market_maker_config
         (symbol, enabled, spread, quote_quantity, max_inventory, target_inventory, max_deviation, target_price, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(symbol) DO UPDATE SET
         enabled = excluded.enabled, spread = excluded.spread, quote_quantity = excluded.quote_quantity,
         max_inventory = excluded.max_inventory, target_inventory = excluded.target_inventory,
         max_deviation = excluded.max_deviation, target_price = excluded.target_price,
         updated_at = datetime('now')`,
    )
    .run(
      symbol,
      input.enabled ? 1 : 0,
      spread,
      quoteQuantity,
      maxInventory,
      targetInventory,
      maxDeviation,
      targetPrice,
    );

  if (!input.enabled) {
    // A disabled desk withdraws its quotes immediately.
    cancelQuotes(symbol, deskUserId());
  }

  return readConfig(symbol)!;
}

/**
 * Fund the desk's inventory for a market.
 *
 * Inventory is real balance moved into the desk's own account, drawn from a
 * named treasury account so the venue books where the liquidity came from.
 * A shortfall in that account is refused rather than minted.
 */
export function fundMarketMaker(symbol: string, baseAmount: number, quoteAmount: number): MarketMakerStatus {
  const { base, quote } = pairFor(symbol);
  const userId = deskUserId();

  if (baseAmount > 0) {
    debitTreasury(base, INVENTORY_ACCOUNT, baseAmount);
    creditAvailable(userId, base, baseAmount);
    recordMovement(base, `treasury:${INVENTORY_ACCOUNT}`, `user:${userId}`, baseAmount, 'market_maker_fund');
  }
  if (quoteAmount > 0) {
    debitTreasury(quote, INVENTORY_ACCOUNT, quoteAmount);
    creditAvailable(userId, quote, quoteAmount);
    recordMovement(quote, `treasury:${INVENTORY_ACCOUNT}`, `user:${userId}`, quoteAmount, 'market_maker_fund');
  }

  return marketMakerStatus().find((status) => status.symbol === symbol)!;
}

/** Credit a treasury account (creating it on first use). */
export function creditTreasuryInventory(asset: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MarketMakerError('INVALID_AMOUNT', 'amount must be positive', 400);
  }
  getDb()
    .prepare(
      `INSERT INTO treasury_accounts (account_id, asset, network, account_type, balance)
       VALUES (?, ?, 'TIGEREX', ?, ?)
       ON CONFLICT(asset, network, account_type) DO UPDATE SET balance = balance + ?, updated_at = datetime('now')`,
    )
    .run(generateId(), asset.toUpperCase(), INVENTORY_ACCOUNT, amount, amount);
  recordMovement(asset.toUpperCase(), 'external', `treasury:${INVENTORY_ACCOUNT}`, amount, 'market_maker_seed');
}

function debitTreasury(asset: string, accountType: string, amount: number): void {
  const db = getDb();
  const row = db
    .prepare("SELECT account_id, balance FROM treasury_accounts WHERE asset = ? AND network = 'TIGEREX' AND account_type = ?")
    .get(asset.toUpperCase(), accountType) as { account_id: string; balance: number } | undefined;
  if (!row || Number(row.balance) + 1e-9 < amount) {
    throw new MarketMakerError(
      'INVENTORY_FUND_EMPTY',
      `the ${asset} ${accountType} account cannot cover ${amount}`,
      409,
    );
  }
  db.prepare("UPDATE treasury_accounts SET balance = balance - ?, updated_at = datetime('now') WHERE account_id = ?").run(
    amount,
    row.account_id,
  );
}

function recordMovement(asset: string, from: string, to: string, amount: number, reason: string): void {
  getDb()
    .prepare(
      `INSERT INTO treasury_movements (movement_id, asset, from_account, to_account, amount, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(generateId(), asset, from, to, amount, reason);
}
