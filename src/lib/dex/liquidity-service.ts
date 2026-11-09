/**
 * TigerSwap liquidity provision.
 *
 * Adding liquidity moves real balances: the trader's tokens are debited and the
 * pool's reserves grow, in exchange for LP tokens recorded against the
 * position. Removing liquidity burns the LP tokens and returns the trader's
 * proportional share of the reserves. For a concentrated pool the deposit is
 * split by the position's price range using the square-root-price math, and the
 * active liquidity is updated.
 */

import { getDb, generateId } from '@/lib/db';
import { debitAvailable, creditAvailable, covers, availableBalance, recordTransaction } from '@/lib/db/ledger';
import {
  AmmError,
  v2Mint,
  v2Burn,
  v3LiquidityForAmounts,
  v3AmountsForLiquidity,
  tickToSqrtPrice,
} from '@/lib/dex/amm';
import {
  DexError,
  loadPool,
  parseObject,
  parseStringArray,
  applyPoolDeltas,
  updateV3State,
  refreshPoolStats,
  poolTvlUsd,
  lpTokenSymbol,
  assertDexOpen,
  assertNotBlacklisted,
  type DexPoolRow,
} from '@/lib/dex/pool-service';

export { lpTokenSymbol };

export interface AddLiquidityRequest {
  userId: string;
  poolId: string;
  /** Amounts of each pool token to deposit, keyed by symbol. */
  amounts: Record<string, number>;
  /** Lower tick of a concentrated position. */
  tickLower?: number;
  /** Upper tick of a concentrated position. */
  tickUpper?: number;
  /** Lock the LP position until this ISO timestamp. */
  lockedUntil?: string;
}

export interface AddLiquidityResult {
  positionId: string;
  poolId: string;
  liquidity: number;
  amounts: Record<string, number>;
}

/**
 * Add liquidity to a pool.
 *
 * For a V2 or Stable pool the deposit is proportional: the smaller share of the
 * two amounts is used and any excess is not taken. For a concentrated pool the
 * deposit is converted to liquidity over the given range, and the active
 * liquidity rises only when the current price is inside the range.
 */
export function addLiquidity(request: AddLiquidityRequest): AddLiquidityResult {
  assertDexOpen('dex');
  const row = loadPool(request.poolId);
  const tokens = parseStringArray(row.tokens, 'tokens');
  assertNotBlacklisted([
    { kind: 'wallet', value: request.userId },
    { kind: 'pool', value: request.poolId },
    ...tokens.map((token) => ({ kind: 'token' as const, value: token })),
  ]);
  const db = getDb();
  const positionId = generateId();

  const amounts: Record<string, number> = {};
  for (const token of tokens) {
    const value = Number(request.amounts[token]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new DexError('INVALID_AMOUNT', `a positive ${token} amount is required`, 400);
    }
    if (!covers(availableBalance(request.userId, token), value)) {
      throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${token} balance`, 400);
    }
    amounts[token] = value;
  }

  db.transaction(() => {
    if (row.kind === 'v3') {
      addConcentrated(request, row, tokens, amounts, positionId);
      return;
    }

    const reserves = parseObject(row.reserves, 'reserves');
    let used: Record<string, number>;
    let liquidity: number;
    if (row.kind === 'v2' && tokens.length === 2) {
      const minted = v2Mint(
        row.total_supply,
        { reserveIn: reserves[tokens[0]], reserveOut: reserves[tokens[1]] },
        amounts[tokens[0]],
        amounts[tokens[1]],
      );
      used = { [tokens[0]]: minted.amountInUsed, [tokens[1]]: minted.amountOutUsed };
      liquidity = minted.liquidity;
    } else {
      used = proportionalMint(row.total_supply, reserves, tokens, amounts);
      liquidity = proportionalLiquidity(row.total_supply, reserves, tokens, used);
    }
    if (!Number.isFinite(liquidity) || liquidity <= 0) {
      throw new DexError('INVALID_AMOUNT', 'deposit cannot mint any liquidity', 400);
    }

    for (const token of tokens) {
      debitAvailable(request.userId, token, used[token]);
      recordTransaction(request.userId, 'dex_add_liquidity', token, used[token], 0, 'completed', `pool ${request.poolId}`);
    }

    growReserves(request.poolId, tokens, used);

    db.prepare("UPDATE dex_pools SET total_supply = total_supply + ?, updated_at = datetime('now') WHERE pool_id = ?").run(liquidity, request.poolId);

    // The LP tokens are minted into the provider's ledger balance so they can be
    // staked in a farm or transferred; the position row alone is not a claim.
    creditAvailable(request.userId, lpTokenSymbol(row), liquidity);
    recordTransaction(request.userId, 'dex_mint_lp', lpTokenSymbol(row), liquidity, 0, 'completed', `pool ${request.poolId}`);

    upsertPosition(request, tokens, used, liquidity, positionId);
    refreshPoolStats(request.poolId);
  })();

  return { positionId, poolId: request.poolId, liquidity: positionLiquidity(request.userId, request.poolId), amounts };
}

/** Deposit amounts actually taken for each token, keyed by symbol. */
function proportionalMint(
  totalSupply: number,
  reserves: Record<string, number>,
  tokens: string[],
  amounts: Record<string, number>,
): Record<string, number> {
  let ratio = Infinity;
  for (const token of tokens) {
    if (!Number.isFinite(reserves[token]) || reserves[token] <= 0) {
      throw new DexError('EMPTY_POOL', `pool has no reserve for ${token}`, 409);
    }
    ratio = Math.min(ratio, amounts[token] / reserves[token]);
  }
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new DexError('INVALID_AMOUNT', 'deposit is too small relative to the pool', 400);
  }
  const used: Record<string, number> = {};
  for (const token of tokens) used[token] = reserves[token] * ratio;
  if (totalSupply === 0) {
    for (const token of tokens) used[token] = amounts[token];
  }
  return used;
}

/** LP tokens minted for a proportional deposit. */
function proportionalLiquidity(
  totalSupply: number,
  reserves: Record<string, number>,
  tokens: string[],
  used: Record<string, number>,
): number {
  if (totalSupply === 0) return Math.sqrt(used[tokens[0]] * (used[tokens[1]] ?? used[tokens[0]]));
  return totalSupply * (used[tokens[0]] / reserves[tokens[0]]);
}

/** Grow a pool's reserves by the deposited amounts. */
function growReserves(poolId: string, tokens: string[], used: Record<string, number>): void {
  const row = loadPool(poolId);
  const reserves = parseObject(row.reserves, 'reserves');
  for (const token of tokens) {
    if (!Number.isFinite(used[token]) || used[token] <= 0) {
      throw new DexError('INVALID_AMOUNT', 'deposit amounts must be positive', 400);
    }
    reserves[token] += used[token];
  }
  getDb().prepare("UPDATE dex_pools SET reserves = ?, updated_at = datetime('now') WHERE pool_id = ?").run(JSON.stringify(reserves), poolId);
}

function addConcentrated(
  request: AddLiquidityRequest,
  row: DexPoolRow,
  tokens: string[],
  amounts: Record<string, number>,
  positionId: string,
): void {
  const sqrtPrice = Number(row.sqrt_price);
  if (!Number.isFinite(sqrtPrice) || sqrtPrice <= 0) {
    throw new DexError('CORRUPT_POOL', 'concentrated pool has no current price', 500);
  }
  const tickLower = Number(request.tickLower);
  const tickUpper = Number(request.tickUpper);
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper) || tickLower >= tickUpper) {
    throw new DexError('INVALID_RANGE', 'tickLower must be a lower integer tick than tickUpper', 400);
  }
  const sqrtLower = tickToSqrtPrice(tickLower);
  const sqrtUpper = tickToSqrtPrice(tickUpper);
  const liquidity = v3LiquidityForAmounts(amounts[tokens[0]], amounts[tokens[1]], sqrtPrice, sqrtLower, sqrtUpper);
  if (!Number.isFinite(liquidity) || liquidity <= 0) {
    throw new DexError('INVALID_AMOUNT', 'deposit cannot back any liquidity over this range', 400);
  }
  const used = v3AmountsForLiquidity(liquidity, sqrtPrice, sqrtLower, sqrtUpper);
  const usedMap: Record<string, number> = { [tokens[0]]: used.amount0, [tokens[1]]: used.amount1 };

  for (const token of tokens) {
    debitAvailable(request.userId, token, usedMap[token]);
    recordTransaction(request.userId, 'dex_add_liquidity', token, usedMap[token], 0, 'completed', `pool ${request.poolId}`);
  }

  growReserves(request.poolId, tokens, usedMap);

  const active = sqrtPrice >= sqrtLower && sqrtPrice <= sqrtUpper ? Number(row.liquidity) + liquidity : Number(row.liquidity);
  updateV3State(request.poolId, sqrtPrice, active);
  getDb()
    .prepare("UPDATE dex_pools SET total_supply = total_supply + ?, updated_at = datetime('now') WHERE pool_id = ?")
    .run(liquidity, request.poolId);

  creditAvailable(request.userId, lpTokenSymbol(row), liquidity);
  recordTransaction(request.userId, 'dex_mint_lp', lpTokenSymbol(row), liquidity, 0, 'completed', `pool ${request.poolId}`);

  getDb()
    .prepare(
      `INSERT INTO dex_lp_positions
         (position_id, pool_id, user_id, liquidity, token0, token1, amount0, amount1, locked_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pool_id, user_id) DO UPDATE SET
         liquidity = liquidity + excluded.liquidity,
         amount0 = amount0 + excluded.amount0,
         amount1 = amount1 + excluded.amount1,
         updated_at = datetime('now')`,
    )
    .run(positionId, request.poolId, request.userId, liquidity, tokens[0], tokens[1], used.amount0, used.amount1, request.lockedUntil ?? null);
  refreshPoolStats(request.poolId);
}

function upsertPosition(
  request: AddLiquidityRequest,
  tokens: string[],
  used: Record<string, number>,
  liquidity: number,
  positionId: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO dex_lp_positions
         (position_id, pool_id, user_id, liquidity, token0, token1, amount0, amount1, locked_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(pool_id, user_id) DO UPDATE SET
         liquidity = liquidity + excluded.liquidity,
         amount0 = amount0 + excluded.amount0,
         amount1 = amount1 + excluded.amount1,
         updated_at = datetime('now')`,
    )
    .run(positionId, request.poolId, request.userId, liquidity, tokens[0], tokens[1] ?? '', used[tokens[0]], used[tokens[1]] ?? 0, request.lockedUntil ?? null);
}

export interface RemoveLiquidityRequest {
  userId: string;
  poolId: string;
  /** LP tokens to burn. */
  liquidity: number;
}

export interface RemoveLiquidityResult {
  poolId: string;
  amount0: number;
  amount1: number;
  liquidity: number;
}

/** Remove liquidity: burn LP tokens and return the proportional share. */
export function removeLiquidity(request: RemoveLiquidityRequest): RemoveLiquidityResult {
  // Withdrawal is not paused: a pause blocks new exposure, never the return of
  // a provider's own liquidity.
  const row = loadPool(request.poolId);
  const tokens = parseStringArray(row.tokens, 'tokens');
  assertNotBlacklisted([
    { kind: 'wallet', value: request.userId },
    { kind: 'pool', value: request.poolId },
  ]);
  const position = getDb()
    .prepare('SELECT * FROM dex_lp_positions WHERE pool_id = ? AND user_id = ?')
    .get(request.poolId, request.userId) as
    | { position_id: string; liquidity: number; token0: string; token1: string; locked_until: string | null }
    | undefined;
  if (!position) throw new DexError('NO_POSITION', 'no liquidity position for this pool', 404);

  const burn = Number(request.liquidity);
  if (!Number.isFinite(burn) || burn <= 0) throw new DexError('INVALID_AMOUNT', 'liquidity must be positive', 400);
  if (burn > position.liquidity + 1e-9) throw new DexError('INSUFFICIENT_LIQUIDITY', 'more than the position holds', 400);
  if (position.locked_until && new Date(position.locked_until).getTime() > Date.now()) {
    throw new DexError('POSITION_LOCKED', `position is locked until ${position.locked_until}`, 409);
  }

  const reserves = parseObject(row.reserves, 'reserves');
  const total = row.total_supply;
  if (total <= 0) throw new DexError('CORRUPT_POOL', 'pool has no LP supply', 500);

  const amount0 = (burn * reserves[tokens[0]]) / total;
  const amount1 = tokens[1] ? (burn * reserves[tokens[1]]) / total : 0;

  getDb().transaction(() => {
    const newReserves = { ...reserves };
    newReserves[tokens[0]] -= amount0;
    if (tokens[1]) newReserves[tokens[1]] -= amount1;
    if (newReserves[tokens[0]] < 0 || (tokens[1] && newReserves[tokens[1]] < 0)) {
      throw new DexError('POOL_DRAINED', 'removal would overdraw the pool', 409);
    }
    getDb()
      .prepare("UPDATE dex_pools SET reserves = ?, total_supply = total_supply - ?, updated_at = datetime('now') WHERE pool_id = ?")
      .run(JSON.stringify(newReserves), burn, request.poolId);

    creditAvailable(request.userId, tokens[0], amount0);
    recordTransaction(request.userId, 'dex_remove_liquidity', tokens[0], amount0, 0, 'completed', `pool ${request.poolId}`);
    if (tokens[1]) {
      creditAvailable(request.userId, tokens[1], amount1);
      recordTransaction(request.userId, 'dex_remove_liquidity', tokens[1], amount1, 0, 'completed', `pool ${request.poolId}`);
    }

    // The burned LP tokens leave the provider's balance. When part of the
    // position is staked in a farm the tokens are locked, so the burn fails
    // closed rather than releasing liquidity that is still backing a stake.
    const lpToken = lpTokenSymbol(row);
    if (!covers(availableBalance(request.userId, lpToken), burn)) {
      throw new DexError('LP_STAKED', 'the LP tokens for this position are locked or staked', 409);
    }
    debitAvailable(request.userId, lpToken, burn);
    recordTransaction(request.userId, 'dex_burn_lp', lpToken, burn, 0, 'completed', `pool ${request.poolId}`);

    const remaining = position.liquidity - burn;
    if (remaining <= 1e-12) {
      getDb().prepare('DELETE FROM dex_lp_positions WHERE position_id = ?').run(position.position_id);
    } else {
      getDb()
        .prepare("UPDATE dex_lp_positions SET liquidity = ?, amount0 = amount0 * ?, amount1 = amount1 * ?, updated_at = datetime('now') WHERE position_id = ?")
        .run(remaining, remaining / position.liquidity, remaining / position.liquidity, position.position_id);
    }
    refreshPoolStats(request.poolId);
  })();

  return { poolId: request.poolId, amount0, amount1, liquidity: burn };
}

/** A user's liquidity positions with their pool metadata. */
export function userPositions(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare(
      `SELECT p.*, d.kind, d.tokens, d.reserves, d.total_supply, d.fee, d.tvl_usd
         FROM dex_lp_positions p
         JOIN dex_pools d ON d.pool_id = p.pool_id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC`,
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const tokens = parseStringArray(String(row.tokens), 'tokens');
    const reserves = parseObject(String(row.reserves), 'reserves');
    const total = Number(row.total_supply);
    const liquidity = Number(row.liquidity);
    const share = total > 0 ? liquidity / total : 0;
    return {
      positionId: row.position_id,
      poolId: row.pool_id,
      kind: row.kind,
      tokens,
      liquidity,
      share,
      amount0: share * (reserves[tokens[0]] ?? 0),
      amount1: tokens[1] ? share * (reserves[tokens[1]] ?? 0) : 0,
      lockedUntil: row.locked_until,
      createdAt: row.created_at,
    };
  });
}

/** The LP-token balance of a position. */
export function positionLiquidity(userId: string, poolId: string): number {
  const row = getDb()
    .prepare('SELECT liquidity FROM dex_lp_positions WHERE pool_id = ? AND user_id = ?')
    .get(poolId, userId) as { liquidity: number } | undefined;
  return Number(row?.liquidity) || 0;
}

export { AmmError, v2Burn, poolTvlUsd };
