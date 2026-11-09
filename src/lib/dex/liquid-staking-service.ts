/**
 * TigerSwap liquid staking settlement (stTGR).
 *
 * Staking moves TGR out of the staker's available balance and into the staking
 * contract, which mints stTGR at the prevailing exchange rate. Unstaking burns
 * stTGR and returns TGR at the same rate, less the redemption fee. Rewards are
 * distributed by an operator calling `distributeRewards`, which raises the
 * exchange rate for every holder.
 *
 * The rate is derived from `total_staked / total_shares` on every read, so the
 * ledger and the rate can never disagree — there is no stored rate to drift.
 */

import { getDb, generateId } from '@/lib/db';
import { debitAvailable, creditAvailable, availableBalance, covers, recordTransaction } from '@/lib/db/ledger';
import { AmmError } from '@/lib/dex/amm';
import {
  DexError,
  assertDexOpen,
  recordDexRevenue,
  creditFund,
  debitFund,
  fundBalance,
} from '@/lib/dex/pool-service';
import {
  exchangeRate,
  sharesForStake,
  tgrForUnstake,
  applyRewards,
  type LiquidStakeState,
} from '@/lib/dex/liquid-staking';

interface StakeRow {
  stake_id: string;
  name: string;
  stake_token: string;
  receipt_token: string;
  redemption_fee_bps: number;
  total_staked: number;
  total_shares: number;
  status: string;
}

export interface LiquidStakeDetail {
  stakeId: string;
  name: string;
  stakeToken: string;
  receiptToken: string;
  totalStaked: number;
  totalShares: number;
  exchangeRate: number;
  redemptionFeeBps: number;
  status: string;
}

function loadStake(stakeId: string): StakeRow {
  const row = getDb().prepare('SELECT * FROM dex_liquid_staking WHERE stake_id = ?').get(stakeId) as StakeRow | undefined;
  if (!row) throw new DexError('UNKNOWN_STAKE', `liquid staking pool ${stakeId} does not exist`, 404);
  return row;
}

function stateOf(row: StakeRow): LiquidStakeState {
  return { totalStaked: Number(row.total_staked), totalShares: Number(row.total_shares), pendingWithdrawal: 0 };
}

function detailOf(row: StakeRow): LiquidStakeDetail {
  return {
    stakeId: row.stake_id,
    name: row.name,
    stakeToken: row.stake_token,
    receiptToken: row.receipt_token,
    totalStaked: Number(row.total_staked),
    totalShares: Number(row.total_shares),
    exchangeRate: exchangeRate(stateOf(row)),
    redemptionFeeBps: Number(row.redemption_fee_bps),
    status: row.status,
  };
}

export function listLiquidStaking(): LiquidStakeDetail[] {
  const rows = getDb().prepare('SELECT * FROM dex_liquid_staking ORDER BY created_at DESC').all() as StakeRow[];
  return rows.map(detailOf);
}

export function liquidStakeDetail(stakeId: string): LiquidStakeDetail {
  return detailOf(loadStake(stakeId));
}

export interface StakeResult {
  stakeId: string;
  staked: number;
  shares: number;
  exchangeRate: number;
}

/**
 * Stake `amount` of the stake token and mint the matching stTGR.
 *
 * The staked token is debited from the staker and recorded against the pool, so
 * `total_staked` is backed by real tokens rather than a promise.
 */
export function stakeLiquid(stakeId: string, userId: string, amount: number): StakeResult {
  assertDexOpen('dex');
  const row = loadStake(stakeId);
  if (row.status !== 'active') throw new DexError('STAKE_PAUSED', 'the staking pool is not accepting stakes', 409);

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new DexError('INVALID_AMOUNT', 'amount must be a positive number', 400);
  }
  if (!covers(availableBalance(userId, row.stake_token), value)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${row.stake_token} balance`, 400);
  }

  const state = stateOf(row);
  let shares: number;
  try {
    shares = sharesForStake(state, value);
  } catch (error) {
    throw new DexError('INVALID_AMOUNT', (error as AmmError).message, 400);
  }

  const db = getDb();
  db.transaction(() => {
    debitAvailable(userId, row.stake_token, value);
    recordTransaction(userId, 'dex_liquid_stake', row.stake_token, value, 0, 'completed', `stake ${stakeId}`);
    db.prepare(
      `INSERT INTO dex_liquid_positions (position_id, stake_id, user_id, shares)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stake_id, user_id) DO UPDATE SET shares = shares + excluded.shares, updated_at = datetime('now')`,
    ).run(generateId(), stakeId, userId, shares);
    db.prepare(
      "UPDATE dex_liquid_staking SET total_staked = total_staked + ?, total_shares = total_shares + ?, updated_at = datetime('now') WHERE stake_id = ?",
    ).run(value, shares, stakeId);
  })();

  return { stakeId, staked: value, shares, exchangeRate: exchangeRate(state) };
}

export interface UnstakeResult {
  stakeId: string;
  shares: number;
  gross: number;
  fee: number;
  received: number;
  exchangeRate: number;
}

/** Burn stTGR and return the underlying stake token, less the redemption fee. */
export function unstakeLiquid(stakeId: string, userId: string, shares: number): UnstakeResult {
  const row = loadStake(stakeId);
  const db = getDb();
  const position = db
    .prepare('SELECT * FROM dex_liquid_positions WHERE stake_id = ? AND user_id = ?')
    .get(stakeId, userId) as { position_id: string; shares: number } | undefined;
  if (!position) throw new DexError('NO_POSITION', 'no staking position', 404);

  const burn = Number(shares);
  if (!Number.isFinite(burn) || burn <= 0) throw new DexError('INVALID_AMOUNT', 'shares must be positive', 400);
  if (burn > Number(position.shares) + 1e-9) {
    throw new DexError('INSUFFICIENT_SHARES', 'more shares than the position holds', 400);
  }

  const state = stateOf(row);
  const rate = exchangeRate(state);
  const fee = Number(row.redemption_fee_bps) / 10_000;
  let received: number;
  try {
    received = tgrForUnstake(state, burn, fee);
  } catch (error) {
    throw new DexError('UNSTAKE_BLOCKED', (error as AmmError).message, 409);
  }
  const gross = received / (1 - fee);

  db.transaction(() => {
    const remaining = Number(position.shares) - burn;
    if (remaining <= 1e-12) {
      db.prepare('DELETE FROM dex_liquid_positions WHERE position_id = ?').run(position.position_id);
    } else {
      db.prepare("UPDATE dex_liquid_positions SET shares = ?, updated_at = datetime('now') WHERE position_id = ?").run(
        remaining,
        position.position_id,
      );
    }
    db.prepare(
      "UPDATE dex_liquid_staking SET total_staked = total_staked - ?, total_shares = total_shares - ?, updated_at = datetime('now') WHERE stake_id = ?",
    ).run(gross, burn, stakeId);

    creditAvailable(userId, row.stake_token, received);
    recordTransaction(userId, 'dex_liquid_unstake', row.stake_token, received, 0, 'completed', `stake ${stakeId}`);

    const feeAmount = gross - received;
    if (feeAmount > 0) {
      recordDexRevenue(
        'dex_liquid_staking_fee',
        row.stake_token,
        feeAmount,
        { lp: 0, vetgr: 0, treasury: feeAmount, insurance: 0, burn: 0 },
        `stake ${stakeId}`,
      );
    }
  })();

  return { stakeId, shares: burn, gross, fee: gross - received, received, exchangeRate: rate };
}

export interface DistributeResult {
  stakeId: string;
  rewards: number;
  previousRate: number;
  rate: number;
}

/**
 * Distribute staking rewards, raising the exchange rate.
 *
 * The rewards are real tokens: they are drawn from the liquid-staking reward
 * account, which an operator funds with `fundLiquidStakingRewards`, so the pool
 * can only pay what it actually holds and can never raise the rate out of
 * nothing. The account is keyed to the pool's stake token, so each token has its
 * own funded pool. It refuses when no stTGR is outstanding.
 */
export function distributeRewards(stakeId: string, rewards: number): DistributeResult {
  const row = loadStake(stakeId);
  const amount = Number(rewards);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DexError('INVALID_AMOUNT', 'rewards must be a positive number', 400);
  }

  const state = stateOf(row);
  let result: { totalStaked: number; rate: number; previousRate: number };
  try {
    result = applyRewards(state, amount);
  } catch (error) {
    throw new DexError('INVALID_REWARDS', (error as AmmError).message, 409);
  }

  getDb().transaction(() => {
    // The reward account must hold the tokens before the rate can rise; a short
    // account fails closed rather than minting the difference.
    debitFund(liquidRewardAccount(row.stake_token), row.stake_token, amount);
    getDb()
      .prepare("UPDATE dex_liquid_staking SET total_staked = ?, updated_at = datetime('now') WHERE stake_id = ?")
      .run(result.totalStaked, stakeId);
  })();

  return { stakeId, rewards: amount, previousRate: result.previousRate, rate: result.rate };
}

/** The reward account that funds a stake token's liquid-staking pool. */
export function liquidRewardAccount(stakeToken: string): string {
  return `dex_liquid_staking_rewards:${stakeToken.toUpperCase()}`;
}

/** Move tokens into a stake token's liquid-staking reward account. */
export function fundLiquidStakingRewards(stakeToken: string, amount: number): void {
  creditFund(liquidRewardAccount(stakeToken), stakeToken, amount);
}

/** The balance available to distribute for a stake token. */
export function liquidRewardBalance(stakeToken: string): number {
  return fundBalance(liquidRewardAccount(stakeToken), stakeToken);
}

/** A user's stTGR positions with the current rate and redemption value. */
export function liquidStakePositions(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare(
      `SELECT p.*, s.name, s.stake_token, s.receipt_token, s.total_staked, s.total_shares, s.redemption_fee_bps
         FROM dex_liquid_positions p JOIN dex_liquid_staking s ON s.stake_id = p.stake_id
        WHERE p.user_id = ? ORDER BY p.created_at DESC`,
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const state = { totalStaked: Number(row.total_staked), totalShares: Number(row.total_shares), pendingWithdrawal: 0 };
    const shares = Number(row.shares);
    const rate = exchangeRate(state);
    return {
      positionId: row.position_id,
      stakeId: row.stake_id,
      name: row.name,
      stakeToken: row.stake_token,
      receiptToken: row.receipt_token,
      shares,
      exchangeRate: rate,
      value: shares * rate,
      redemptionFeeBps: Number(row.redemption_fee_bps),
      createdAt: row.created_at,
    };
  });
}
