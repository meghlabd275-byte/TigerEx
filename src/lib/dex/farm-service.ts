/**
 * TigerSwap farm, veTGR, gauge, bribe and vault services.
 *
 * A farm pays its reward token per second over the stake the caller holds; the
 * reward accounting is the MasterChef accumulator in `./staking`, and the stake
 * itself is a real ledger movement. veTGR locks TGR for voting power, gauges
 * weight the emission a pool receives, and bribes are paid by third parties for
 * those votes. Every mutation is inside one transaction.
 */

import { getDb, generateId } from '@/lib/db';
import { parseUtcTimestamp } from '@/lib/trading/candles';
import { debitAvailable, creditAvailable, lockAvailable, unlockAvailable, covers, availableBalance, recordTransaction } from '@/lib/db/ledger';
import {
  DexError,
  dexSetting,
  lpTokenSymbol,
  assertDexOpen,
  assertNotBlacklisted,
  creditTreasury,
  creditFund,
  debitFund,
  fundBalance,
} from '@/lib/dex/pool-service';
import {
  accrueFarm,
  pendingFarmRewards,
  rewardDebtFor,
  farmWeight,
  veVotingPower,
  veUnlockAt,
  gaugeEmission,
  MAX_LOCK_DAYS,
  MIN_LOCK_DAYS,
} from '@/lib/dex/staking';

interface FarmRow {
  farm_id: string;
  name: string;
  pool_id: string;
  reward_token: string;
  reward_rate: number;
  apr: number;
  total_staked: number;
  boost_multiplier: number;
  vetgr: number;
  start_at: string | null;
  end_at: string | null;
  status: string;
}

function loadFarm(farmId: string): FarmRow {
  const row = getDb().prepare('SELECT * FROM dex_farms WHERE farm_id = ?').get(farmId) as FarmRow | undefined;
  if (!row) throw new DexError('UNKNOWN_FARM', `farm ${farmId} does not exist`, 404);
  if (row.status !== 'active') throw new DexError('FARM_INACTIVE', `farm ${farmId} is ${row.status}`, 409);
  return row;
}

function nowMs(): number {
  return Date.now();
}

/** The veTGR balance a user currently holds, as a lock's voting power. */
function vetgrBalance(userId: string): number {
  const lock = getDb()
    .prepare('SELECT voting_power, unlock_at FROM dex_ve_locks WHERE user_id = ?')
    .get(userId) as { voting_power: number; unlock_at: string } | undefined;
  if (!lock) return 0;
  const unlock = parseUtcTimestamp(lock.unlock_at);
  if (Number.isFinite(unlock) && unlock <= Date.now()) return 0;
  return Number(lock.voting_power) || 0;
}

/** The total veTGR outstanding, which sets each holder's share of the boost. */
function totalVetgr(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(voting_power), 0) AS total FROM dex_ve_locks WHERE unlock_at > datetime('now')")
    .get() as { total: number };
  return Number(row.total) || 0;
}

/**
 * The weight a stake carries in a farm's reward split.
 *
 * A boosted farm splits its emission by weight, so a position holding veTGR
 * earns a larger share of the same fixed emission; the weight is the raw stake
 * scaled by the position's boost. A farm with boosting off uses the raw stake.
 */
function stakeWeight(farm: FarmRow, userId: string, amount: number): number {
  if (!Number(farm.vetgr)) return amount;
  return farmWeight(amount, vetgrBalance(userId), totalVetgr(), Number(farm.boost_multiplier) || 2.5);
}

/** The farm's total weight, the denominator of the reward split. */
function totalFarmWeight(farm: FarmRow): number {
  if (!Number(farm.vetgr)) {
    const row = getDb()
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM dex_farm_stakes WHERE farm_id = ?')
      .get(farm.farm_id) as { total: number };
    return Number(row.total) || 0;
  }
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(weighted_weight), 0) AS total FROM dex_farm_stakes WHERE farm_id = ?')
    .get(farm.farm_id) as { total: number };
  return Number(row.total) || 0;
}

/** The farm's accumulator advanced to now, split by its total weight. */
function currentFarmState(farm: FarmRow) {
  const meta = getDb()
    .prepare('SELECT acc_reward_per_share, last_update FROM dex_farm_meta WHERE farm_id = ?')
    .get(farm.farm_id) as { acc_reward_per_share: number; last_update: number } | undefined;
  const base = {
    accRewardPerShare: Number(meta?.acc_reward_per_share) || 0,
    totalStaked: Number(farm.total_staked) || 0,
    rewardRate: Number(farm.reward_rate),
    lastUpdate: Number(meta?.last_update) || nowMs(),
  };
  return accrueFarm(base, nowMs(), totalFarmWeight(farm));
}

function persistFarmMeta(farmId: string, state: { accRewardPerShare: number; lastUpdate: number }): void {
  getDb()
    .prepare(
      `INSERT INTO dex_farm_meta (farm_id, acc_reward_per_share, last_update) VALUES (?, ?, ?)
       ON CONFLICT(farm_id) DO UPDATE SET acc_reward_per_share = excluded.acc_reward_per_share, last_update = excluded.last_update`,
    )
    .run(farmId, state.accRewardPerShare, state.lastUpdate);
}

/**
 * Farm rewards are paid from a funded account rather than minted.
 *
 * The accumulator says how much a stake has earned; this account says how much
 * the protocol actually set aside to pay. Settlement pays the smaller of the
 * two, so a farm that was never funded — or whose fund has run dry — pays
 * nothing instead of conjuring reward tokens into a claimer's balance. Fund the
 * account with `fundFarmRewards`.
 */
const REWARD_FUND = 'dex_farm_rewards';

/** The balance of a farm's reward account for one asset. */
export function rewardFundBalance(asset: string): number {
  return fundBalance(REWARD_FUND, asset);
}

/** Move an amount into a farm's reward account, creating it on first use. */
export function fundFarmRewards(asset: string, amount: number): void {
  creditFund(REWARD_FUND, asset, amount);
}

function debitRewardFund(asset: string, amount: number): void {
  debitFund(REWARD_FUND, asset, amount);
}

interface RewardSettlement {
  /** Reward actually paid out of the fund. */
  payable: number;
  /** Reward earned but left unpaid because the fund is short. */
  unpaid: number;
  /** The stake's new reward debt, carrying the unpaid amount forward. */
  debt: number;
}

/**
 * Pay what the fund can cover for a stake and return the new reward debt.
 *
 * The debt is advanced only by what was paid, so any shortfall stays pending and
 * is paid once the fund is refilled; a shortfall is never silently forgiven.
 * The weight is the stake's boosted weight, the same figure the accumulator was
 * advanced by, so the pending reward is what the position actually earned.
 */
function settleFarmReward(
  userId: string,
  farm: FarmRow,
  weight: number,
  rewardDebt: number,
  accRewardPerShare: number,
): RewardSettlement {
  const pending = pendingFarmRewards(weight, accRewardPerShare, rewardDebt);
  const payable = Math.max(0, Math.min(pending, rewardFundBalance(farm.reward_token)));
  if (payable > 0) {
    debitRewardFund(farm.reward_token, payable);
    creditAvailable(userId, farm.reward_token, payable);
    recordTransaction(userId, 'dex_farm_reward', farm.reward_token, payable, 0, 'completed', `farm ${farm.farm_id}`);
  }
  const unpaid = pending - payable;
  return { payable, unpaid, debt: rewardDebtFor(weight, accRewardPerShare) - unpaid };
}

export interface StakeResult {
  farmId: string;
  staked: number;
  pending: number;
}

/**
 * Stake into a farm.
 *
 * The LP tokens are debited from the caller and held by the farm contract; the
 * caller's pending rewards are settled first so the accounting never mixes
 * before and after the deposit.
 */
export function stakeFarm(userId: string, farmId: string, amount: number): StakeResult {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  assertDexOpen('dex');
  const farm = loadFarm(farmId);
  assertNotBlacklisted([
    { kind: 'wallet', value: userId },
    { kind: 'pool', value: farm.pool_id },
  ]);
  const pool = getDb().prepare('SELECT kind, tokens FROM dex_pools WHERE pool_id = ?').get(farm.pool_id) as
    | { kind: string; tokens: string }
    | undefined;
  if (!pool) throw new DexError('UNKNOWN_POOL', 'the farm points at a missing pool', 500);
  const lpToken = lpTokenSymbol(pool);

  if (!covers(availableBalance(userId, lpToken), amount)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${lpToken} balance`, 400);
  }

  const stake = getDb()
    .prepare('SELECT * FROM dex_farm_stakes WHERE farm_id = ? AND user_id = ?')
    .get(farmId, userId) as
    | { stake_id: string; amount: number; reward_debt: number; weighted_weight: number }
    | undefined;

  const result = getDb().transaction(() => {
    const state = currentFarmState(farm);
    const newAmount = (Number(stake?.amount) || 0) + amount;
    const newWeight = stakeWeight(farm, userId, newAmount);

    lockAvailable(userId, lpToken, amount);
    recordTransaction(userId, 'dex_farm_stake', lpToken, amount, 0, 'completed', `farm ${farmId}`);

    // Rewards earned before this deposit are settled first, paid from the farm's
    // reward fund; a shortfall stays pending rather than being minted, so the
    // new stake's debt is reduced by whatever could not be paid. The weight used
    // is the one the stake was last accounted at, not the new one, so the boost
    // from the new deposit cannot retroactively boost rewards already earned.
    const settlement = stake
      ? settleFarmReward(userId, farm, Number(stake.weighted_weight) || Number(stake.amount), Number(stake.reward_debt), state.accRewardPerShare)
      : { payable: 0, unpaid: 0, debt: 0 };
    const debt = rewardDebtFor(newWeight, state.accRewardPerShare) - settlement.unpaid;
    if (stake) {
      getDb()
        .prepare(
          "UPDATE dex_farm_stakes SET amount = ?, reward_debt = ?, weighted_weight = ?, updated_at = datetime('now') WHERE stake_id = ?",
        )
        .run(newAmount, debt, newWeight, stake.stake_id);
    } else {
      getDb()
        .prepare(
          'INSERT INTO dex_farm_stakes (stake_id, farm_id, user_id, amount, reward_debt, weighted_weight) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(generateId(), farmId, userId, newAmount, debt, newWeight);
    }
    persistFarmMeta(farmId, state);
    getDb()
      .prepare("UPDATE dex_farms SET total_staked = total_staked + ?, updated_at = datetime('now') WHERE farm_id = ?")
      .run(amount, farmId);
    return { farmId, staked: newAmount, pending: settlement.payable };
  })();

  return result as StakeResult;
}

export interface UnstakeResult {
  farmId: string;
  remaining: number;
  pending: number;
}

/** Unstake from a farm, settling pending rewards and returning the LP tokens. */
export function unstakeFarm(userId: string, farmId: string, amount: number): UnstakeResult {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  // Unstaking is never paused, so a pause cannot strand a staker's LP tokens.
  const farm = loadFarm(farmId);
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const stake = getDb()
    .prepare('SELECT * FROM dex_farm_stakes WHERE farm_id = ? AND user_id = ?')
    .get(farmId, userId) as
    | { stake_id: string; amount: number; reward_debt: number; weighted_weight: number }
    | undefined;
  if (!stake) throw new DexError('NO_STAKE', 'no stake in this farm', 404);
  if (amount > stake.amount + 1e-9) throw new DexError('INSUFFICIENT_STAKE', 'amount exceeds the stake', 400);

  const pool = getDb().prepare('SELECT kind, tokens FROM dex_pools WHERE pool_id = ?').get(farm.pool_id) as
    | { kind: string; tokens: string }
    | undefined;
  if (!pool) throw new DexError('UNKNOWN_POOL', 'the farm points at a missing pool', 500);
  const lpToken = lpTokenSymbol(pool);

  const result = getDb().transaction(() => {
    const state = currentFarmState(farm);
    const remaining = stake.amount - amount;
    const remainingWeight = stakeWeight(farm, userId, remaining);

    unlockAvailable(userId, lpToken, amount);
    recordTransaction(userId, 'dex_farm_unstake', lpToken, amount, 0, 'completed', `farm ${farmId}`);

    // Settle the earned rewards out of the fund; an unfunded shortfall is
    // dropped, because a position that is leaving the farm holds no claim on
    // rewards the protocol never set aside. The weight is the one the stake was
    // last accounted at, so the withdrawal cannot retroactively change what it
    // already earned.
    const settlement = settleFarmReward(
      userId,
      farm,
      Number(stake.weighted_weight) || Number(stake.amount),
      stake.reward_debt,
      state.accRewardPerShare,
    );

    if (remaining <= 1e-12) {
      getDb().prepare('DELETE FROM dex_farm_stakes WHERE stake_id = ?').run(stake.stake_id);
    } else {
      getDb()
        .prepare(
          "UPDATE dex_farm_stakes SET amount = ?, reward_debt = ?, weighted_weight = ?, updated_at = datetime('now') WHERE stake_id = ?",
        )
        .run(remaining, rewardDebtFor(remainingWeight, state.accRewardPerShare), remainingWeight, stake.stake_id);
    }
    persistFarmMeta(farmId, state);
    getDb()
      .prepare("UPDATE dex_farms SET total_staked = total_staked - ?, updated_at = datetime('now') WHERE farm_id = ?")
      .run(amount, farmId);
    return { farmId, remaining, pending: settlement.payable };
  })();

  return result as UnstakeResult;
}

/** Claim a farm's pending rewards without changing the stake. */
export function claimFarm(userId: string, farmId: string): number {
  // Claiming rewards is never paused; the rewards are already earned.
  const farm = loadFarm(farmId);
  assertNotBlacklisted([{ kind: 'wallet', value: userId }]);
  const stake = getDb()
    .prepare('SELECT * FROM dex_farm_stakes WHERE farm_id = ? AND user_id = ?')
    .get(farmId, userId) as
    | { stake_id: string; amount: number; reward_debt: number; weighted_weight: number }
    | undefined;
  if (!stake) throw new DexError('NO_STAKE', 'no stake in this farm', 404);

  return getDb().transaction(() => {
    const state = currentFarmState(farm);
    const settlement = settleFarmReward(
      userId,
      farm,
      Number(stake.weighted_weight) || Number(stake.amount),
      stake.reward_debt,
      state.accRewardPerShare,
    );
    if (settlement.payable <= 0 && settlement.unpaid <= 0) return 0;
    getDb()
      .prepare("UPDATE dex_farm_stakes SET reward_debt = ?, updated_at = datetime('now') WHERE stake_id = ?")
      .run(settlement.debt, stake.stake_id);
    persistFarmMeta(farmId, state);
    return settlement.payable;
  })() as number;
}

/** A user's farm positions with their live pending rewards. */
export function farmPositions(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare(
      `SELECT s.*, f.name, f.reward_token, f.reward_rate, f.apr, f.boost_multiplier, f.vetgr, f.status AS farm_status, f.pool_id
         FROM dex_farm_stakes s JOIN dex_farms f ON f.farm_id = s.farm_id
        WHERE s.user_id = ?`,
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const farm = loadFarmRow(String(row.farm_id));
    const state = farm ? currentFarmState(farm) : null;
    // The weight is what the accumulator was advanced by, so it is the figure
    // the pending reward is computed from; the raw stake is shown alongside it.
    const weight = Number(row.weighted_weight) || Number(row.amount);
    const pending = state
      ? pendingFarmRewards(weight, state.accRewardPerShare, Number(row.reward_debt))
      : 0;
    const boost = Number(row.amount) > 0 ? weight / Number(row.amount) : 1;
    return {
      farmId: row.farm_id,
      name: row.name,
      poolId: row.pool_id,
      staked: row.amount,
      weight,
      boost,
      boosted: Boolean(Number(row.vetgr)),
      pendingRewards: pending,
      rewardToken: row.reward_token,
      apr: row.apr,
      boostMultiplier: row.boost_multiplier,
    };
  });
}

function loadFarmRow(farmId: string): FarmRow | undefined {
  return getDb().prepare('SELECT * FROM dex_farms WHERE farm_id = ?').get(farmId) as FarmRow | undefined;
}

// ============================================================================
// veTGR
// ============================================================================

export interface VeLockResult {
  amount: number;
  unlockAt: string;
  votingPower: number;
}

/**
 * Lock TGR for voting power.
 *
 * An existing lock is extended by the new amount and re-dated to the new
 * unlock, and the lock is held as a real ledger reservation so the same TGR
 * cannot be spent while it is locked.
 */
export function lockVetgr(userId: string, amount: number, lockDays: number): VeLockResult {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  const minDays = dexSetting('dex_ve_lock_min_days', MIN_LOCK_DAYS);
  const maxDays = dexSetting('dex_ve_lock_max_days', MAX_LOCK_DAYS);
  if (!Number.isFinite(lockDays) || lockDays < minDays || lockDays > maxDays) {
    throw new DexError('INVALID_LOCK', `lock duration must be between ${minDays} and ${maxDays} days`, 400);
  }
  const power = veVotingPower({ amount, lockDays });
  const unlockAt = new Date(veUnlockAt(nowMs(), lockDays)).toISOString();

  if (!covers(availableBalance(userId, 'TGR'), amount)) {
    throw new DexError('INSUFFICIENT_BALANCE', 'Insufficient TGR balance', 400);
  }

  const existing = getDb().prepare('SELECT * FROM dex_ve_locks WHERE user_id = ?').get(userId) as
    | { lock_id: string; amount: number; voting_power: number }
    | undefined;

  return getDb().transaction(() => {
    lockAvailable(userId, 'TGR', amount);
    recordTransaction(userId, 'dex_ve_lock', 'TGR', amount, 0, 'completed', 'veTGR lock');
    if (existing) {
      const total = existing.amount + amount;
      const newPower = total * (lockDays / maxDays);
      getDb()
        .prepare("UPDATE dex_ve_locks SET amount = ?, unlock_at = ?, voting_power = ?, updated_at = datetime('now') WHERE lock_id = ?")
        .run(total, unlockAt, newPower, existing.lock_id);
      return { amount: total, unlockAt, votingPower: newPower };
    }
    getDb()
      .prepare('INSERT INTO dex_ve_locks (lock_id, user_id, amount, unlock_at, voting_power) VALUES (?, ?, ?, ?, ?)')
      .run(generateId(), userId, amount, unlockAt, power);
    return { amount, unlockAt, votingPower: power };
  })() as VeLockResult;
}

/** Release a matured veTGR lock back to the caller's available balance. */
export function unlockVetgr(userId: string): number {
  const lock = getDb().prepare('SELECT * FROM dex_ve_locks WHERE user_id = ?').get(userId) as
    | { lock_id: string; amount: number; unlock_at: string }
    | undefined;
  if (!lock) throw new DexError('NO_LOCK', 'no veTGR lock for this account', 404);
  if (parseUtcTimestamp(lock.unlock_at) > nowMs()) {
    throw new DexError('LOCK_NOT_MATURED', `the lock matures at ${lock.unlock_at}`, 409);
  }
  return getDb().transaction(() => {
    unlockAvailable(userId, 'TGR', lock.amount);
    recordTransaction(userId, 'dex_ve_unlock', 'TGR', lock.amount, 0, 'completed', 'veTGR unlock');
    getDb().prepare('DELETE FROM dex_ve_locks WHERE lock_id = ?').run(lock.lock_id);
    return lock.amount;
  })() as number;
}

/** The caller's veTGR lock and current voting power. */
export function vetgrStatus(userId: string): Record<string, unknown> | null {
  const lock = getDb().prepare('SELECT * FROM dex_ve_locks WHERE user_id = ?').get(userId) as
    | { amount: number; unlock_at: string; voting_power: number }
    | undefined;
  if (!lock) return null;
  const totalLocked = getDb().prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM dex_ve_locks').get() as {
    total: number;
  };
  const share = totalLocked.total > 0 ? lock.amount / totalLocked.total : 0;
  return {
    amount: lock.amount,
    unlockAt: lock.unlock_at,
    votingPower: lock.voting_power,
    shareOfTotal: share,
  };
}

/**
 * The current balance of the veTGR fee pot for an asset, and the epoch it was
 * last distributed at.
 */
export function vetgrFeePot(asset: string): { asset: string; balance: number; lastEpoch: number } {
  const key = `dex_vetgr_fee_epoch_${asset.toUpperCase()}`;
  const row = getDb().prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return {
    asset: asset.toUpperCase(),
    balance: fundBalance('dex_vetgr_fees', asset.toUpperCase()),
    lastEpoch: Number(row?.value ?? 0),
  };
}

/**
 * Distribute the protocol's veTGR fee share to veTGR holders.
 *
 * Every settlement already carved the veTGR share of its fee out of the pool
 * into the `dex_vetgr_fees` account, so this is a real transfer of held funds,
 * never a mint: the whole pot is debited and paid to the lockers pro-rata by
 * locked amount. Each asset is distributed at most once per voting epoch, so a
 * keeper that calls this every cycle still pays out once an epoch. When nothing
 * is locked the fees stay in the account for the next lock rather than being
 * paid to nobody.
 */
export function distributeVetgrFees(): Array<{ asset: string; epoch: number; distributed: number; holders: number }> {
  const db = getDb();
  const epoch = currentEpoch();
  const pots = db
    .prepare("SELECT asset, balance FROM treasury_accounts WHERE network = 'TIGEREX' AND account_type = 'dex_vetgr_fees' AND balance > 0")
    .all() as Array<{ asset: string; balance: number }>;
  const locks = db.prepare('SELECT user_id, amount FROM dex_ve_locks WHERE amount > 0').all() as Array<{
    user_id: string;
    amount: number;
  }>;
  const totalLocked = locks.reduce((sum, lock) => sum + Number(lock.amount), 0);

  const results: Array<{ asset: string; epoch: number; distributed: number; holders: number }> = [];
  for (const pot of pots) {
    const key = `dex_vetgr_fee_epoch_${pot.asset}`;
    const last = Number(
      (db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? 0,
    );
    const amount = Number(pot.balance);
    if (last >= epoch || !(amount > 0) || totalLocked <= 0) continue;

    db.transaction(() => {
      debitFund('dex_vetgr_fees', pot.asset, amount);
      let paid = 0;
      locks.forEach((lock, index) => {
        // The last holder takes the remainder so the parts sum to the pot
        // exactly, however the division rounds.
        const share = index === locks.length - 1 ? amount - paid : (amount * Number(lock.amount)) / totalLocked;
        if (share > 0) {
          creditAvailable(lock.user_id, pot.asset, share);
          paid += share;
        }
      });
      db.prepare(
        `INSERT INTO system_settings (key, value, category, updated_at)
         VALUES (?, ?, 'dex', datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      ).run(key, String(epoch));
    })();

    results.push({ asset: pot.asset, epoch, distributed: amount, holders: locks.length });
  }
  return results;
}

// ============================================================================
// Gauges and bribes
// ============================================================================

/** The current voting epoch, a two-week window from the Unix epoch. */
export function currentEpoch(at = nowMs()): number {
  const twoWeeks = 14 * 24 * 60 * 60 * 1000;
  return Math.floor(at / twoWeeks);
}

/** Cast or replace a gauge vote with the caller's full voting power. */
export function voteGauge(userId: string, gaugeId: string, weight: number): void {
  if (!Number.isFinite(weight) || weight < 0) throw new DexError('INVALID_WEIGHT', 'weight must not be negative', 400);
  const lock = getDb().prepare('SELECT voting_power FROM dex_ve_locks WHERE user_id = ?').get(userId) as
    | { voting_power: number }
    | undefined;
  if (!lock) throw new DexError('NO_LOCK', 'a veTGR lock is required to vote', 403);
  if (weight > lock.voting_power + 1e-9) {
    throw new DexError('INSUFFICIENT_VOTING_POWER', 'weight exceeds the voting power held', 400);
  }
  const gauge = getDb().prepare('SELECT gauge_id FROM dex_gauges WHERE gauge_id = ?').get(gaugeId);
  if (!gauge) throw new DexError('UNKNOWN_GAUGE', 'gauge does not exist', 404);

  const epoch = currentEpoch();
  getDb()
    .prepare(
      `INSERT INTO dex_gauge_votes (vote_id, gauge_id, user_id, weight, epoch) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(gauge_id, user_id, epoch) DO UPDATE SET weight = excluded.weight`,
    )
    .run(generateId(), gaugeId, userId, weight, epoch);
  recomputeGaugeWeights(epoch);
}

/** Recompute every gauge's weight and emission share for an epoch. */
export function recomputeGaugeWeights(epoch = currentEpoch()): void {
  const db = getDb();
  const rows = db
    .prepare('SELECT gauge_id, COALESCE(SUM(weight), 0) AS weight FROM dex_gauge_votes WHERE epoch = ? GROUP BY gauge_id')
    .all(epoch) as Array<{ gauge_id: string; weight: number }>;
  const total = rows.reduce((acc, r) => acc + Number(r.weight), 0);
  for (const row of rows) {
    const bps = total > 0 ? Math.round((Number(row.weight) / total) * 10_000) : 0;
    db.prepare("UPDATE dex_gauges SET weight = ?, emission_bps = ?, updated_at = datetime('now') WHERE gauge_id = ?").run(
      row.weight,
      bps,
      row.gauge_id,
    );
  }
}

/** The emission a gauge receives from an epoch's total reward. */
export function gaugeReward(gaugeId: string, epochEmission: number): number {
  const row = getDb().prepare('SELECT weight FROM dex_gauges WHERE gauge_id = ?').get(gaugeId) as
    | { weight: number }
    | undefined;
  if (!row) throw new DexError('UNKNOWN_GAUGE', 'gauge does not exist', 404);
  const total = getDb().prepare('SELECT COALESCE(SUM(weight), 0) AS total FROM dex_gauges').get() as { total: number };
  return gaugeEmission(Number(row.weight), Number(total.total), epochEmission);
}

/** Record a bribe offered to voters of a gauge. */
export function submitBribe(sponsor: string, gaugeId: string, token: string, amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new DexError('INVALID_AMOUNT', 'amount must be positive', 400);
  const gauge = getDb().prepare('SELECT gauge_id FROM dex_gauges WHERE gauge_id = ?').get(gaugeId);
  if (!gauge) throw new DexError('UNKNOWN_GAUGE', 'gauge does not exist', 404);
  const asset = String(token).trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(asset)) throw new DexError('INVALID_SYMBOL', 'token must be an asset symbol', 400);

  // A bribe is a real transfer, not a promise: the sponsor's tokens leave their
  // balance and are held in a per-bribe escrow that only the voters can draw.
  // Recording the amount without moving it would leave the venue owing tokens it
  // never received, and a claim would then have to mint them.
  if (!covers(availableBalance(sponsor, asset), amount)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`, 400);
  }

  const bribeId = generateId();
  getDb().transaction(() => {
    debitAvailable(sponsor, asset, amount);
    recordTransaction(sponsor, 'dex_bribe', asset, amount, 0, 'completed', `bribe ${bribeId}`);
    creditFund(bribeEscrowAccount(bribeId), asset, amount);
    getDb()
      .prepare('INSERT INTO dex_bribes (bribe_id, gauge_id, token, amount, sponsor, epoch) VALUES (?, ?, ?, ?, ?, ?)')
      .run(bribeId, gaugeId, asset, amount, sponsor, currentEpoch());
  })();
  return bribeId;
}

/** The escrow account that holds one bribe until its voters claim it. */
export function bribeEscrowAccount(bribeId: string): string {
  return `dex_bribe_escrow:${bribeId}`;
}

export interface BribeClaim {
  bribeId: string;
  token: string;
  amount: number;
}

/**
 * Pay a voter their share of a bribe.
 *
 * The share is the voter's weight in the bribe's gauge for the bribe's epoch
 * over that epoch's total weight, drawn from the bribe's own escrow. The escrow
 * was funded by the sponsor, so the payout moves real tokens rather than
 * minting them; a claim larger than the escrow holds fails closed, and the
 * unique (bribe, voter) row makes a second claim impossible.
 */
export function claimBribe(userId: string, bribeId: string): BribeClaim {
  const bribe = getDb().prepare('SELECT * FROM dex_bribes WHERE bribe_id = ?').get(bribeId) as
    | { bribe_id: string; gauge_id: string; token: string; amount: number; epoch: number }
    | undefined;
  if (!bribe) throw new DexError('UNKNOWN_BRIBE', 'bribe does not exist', 404);

  const vote = getDb()
    .prepare('SELECT weight FROM dex_gauge_votes WHERE gauge_id = ? AND user_id = ? AND epoch = ?')
    .get(bribe.gauge_id, userId, bribe.epoch) as { weight: number } | undefined;
  if (!vote || Number(vote.weight) <= 0) {
    throw new DexError('NO_VOTE', 'no vote in this gauge for the bribe epoch', 403);
  }
  const total = getDb()
    .prepare('SELECT COALESCE(SUM(weight), 0) AS total FROM dex_gauge_votes WHERE gauge_id = ? AND epoch = ?')
    .get(bribe.gauge_id, bribe.epoch) as { total: number };
  const totalWeight = Number(total.total);
  if (totalWeight <= 0) throw new DexError('NO_VOTES', 'the gauge has no votes for this epoch', 409);

  const share = (Number(bribe.amount) * Number(vote.weight)) / totalWeight;
  if (!(share > 0)) throw new DexError('NOTHING_TO_CLAIM', 'the claim amount is zero', 409);

  return getDb().transaction(() => {
    debitFund(bribeEscrowAccount(bribeId), bribe.token, share);
    creditAvailable(userId, bribe.token, share);
    recordTransaction(userId, 'dex_bribe_claim', bribe.token, share, 0, 'completed', `bribe ${bribeId}`);
    getDb()
      .prepare('INSERT INTO dex_bribe_claims (claim_id, bribe_id, user_id, amount) VALUES (?, ?, ?, ?)')
      .run(generateId(), bribeId, userId, share);
    return { bribeId, token: bribe.token, amount: share };
  })() as BribeClaim;
}
