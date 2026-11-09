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
import { debitAvailable, creditAvailable, lockAvailable, unlockAvailable, covers, availableBalance, recordTransaction } from '@/lib/db/ledger';
import {
  DexError,
  dexSetting,
  lpTokenSymbol,
  assertDexOpen,
  assertNotBlacklisted,
} from '@/lib/dex/pool-service';
import {
  accrueFarm,
  pendingFarmRewards,
  rewardDebtFor,
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

/** The farm's accumulator advanced to now, using the pool's staked total. */
function currentFarmState(farm: FarmRow) {
  const stakeRow = getDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM dex_farm_stakes WHERE farm_id = ?')
    .get(farm.farm_id) as { total: number };
  const meta = getDb()
    .prepare('SELECT acc_reward_per_share, last_update FROM dex_farm_meta WHERE farm_id = ?')
    .get(farm.farm_id) as { acc_reward_per_share: number; last_update: number } | undefined;
  const base = {
    accRewardPerShare: Number(meta?.acc_reward_per_share) || 0,
    totalStaked: Number(stakeRow.total) || 0,
    rewardRate: Number(farm.reward_rate),
    lastUpdate: Number(meta?.last_update) || nowMs(),
  };
  return accrueFarm(base, nowMs());
}

function persistFarmMeta(farmId: string, state: { accRewardPerShare: number; lastUpdate: number }): void {
  getDb()
    .prepare(
      `INSERT INTO dex_farm_meta (farm_id, acc_reward_per_share, last_update) VALUES (?, ?, ?)
       ON CONFLICT(farm_id) DO UPDATE SET acc_reward_per_share = excluded.acc_reward_per_share, last_update = excluded.last_update`,
    )
    .run(farmId, state.accRewardPerShare, state.lastUpdate);
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
    .get(farmId, userId) as { stake_id: string; amount: number; reward_debt: number } | undefined;

  const result = getDb().transaction(() => {
    const state = currentFarmState(farm);
    const pending = pendingFarmRewards(Number(stake?.amount) || 0, state.accRewardPerShare, Number(stake?.reward_debt) || 0);
    const newAmount = (Number(stake?.amount) || 0) + amount;

    lockAvailable(userId, lpToken, amount);
    recordTransaction(userId, 'dex_farm_stake', lpToken, amount, 0, 'completed', `farm ${farmId}`);

    if (pending > 0) {
      creditAvailable(userId, farm.reward_token, pending);
      recordTransaction(userId, 'dex_farm_reward', farm.reward_token, pending, 0, 'completed', `farm ${farmId}`);
    }

    const debt = rewardDebtFor(newAmount, state.accRewardPerShare);
    if (stake) {
      getDb()
        .prepare("UPDATE dex_farm_stakes SET amount = ?, reward_debt = ?, updated_at = datetime('now') WHERE stake_id = ?")
        .run(newAmount, debt, stake.stake_id);
    } else {
      getDb()
        .prepare('INSERT INTO dex_farm_stakes (stake_id, farm_id, user_id, amount, reward_debt) VALUES (?, ?, ?, ?, ?)')
        .run(generateId(), farmId, userId, newAmount, debt);
    }
    persistFarmMeta(farmId, state);
    getDb()
      .prepare("UPDATE dex_farms SET total_staked = total_staked + ?, updated_at = datetime('now') WHERE farm_id = ?")
      .run(amount, farmId);
    return { farmId, staked: newAmount, pending };
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
    .get(farmId, userId) as { stake_id: string; amount: number; reward_debt: number } | undefined;
  if (!stake) throw new DexError('NO_STAKE', 'no stake in this farm', 404);
  if (amount > stake.amount + 1e-9) throw new DexError('INSUFFICIENT_STAKE', 'amount exceeds the stake', 400);

  const pool = getDb().prepare('SELECT kind, tokens FROM dex_pools WHERE pool_id = ?').get(farm.pool_id) as
    | { kind: string; tokens: string }
    | undefined;
  if (!pool) throw new DexError('UNKNOWN_POOL', 'the farm points at a missing pool', 500);
  const lpToken = lpTokenSymbol(pool);

  const result = getDb().transaction(() => {
    const state = currentFarmState(farm);
    const pending = pendingFarmRewards(stake.amount, state.accRewardPerShare, stake.reward_debt);
    const remaining = stake.amount - amount;

    unlockAvailable(userId, lpToken, amount);
    recordTransaction(userId, 'dex_farm_unstake', lpToken, amount, 0, 'completed', `farm ${farmId}`);
    if (pending > 0) {
      creditAvailable(userId, farm.reward_token, pending);
      recordTransaction(userId, 'dex_farm_reward', farm.reward_token, pending, 0, 'completed', `farm ${farmId}`);
    }

    if (remaining <= 1e-12) {
      getDb().prepare('DELETE FROM dex_farm_stakes WHERE stake_id = ?').run(stake.stake_id);
    } else {
      getDb()
        .prepare("UPDATE dex_farm_stakes SET amount = ?, reward_debt = ?, updated_at = datetime('now') WHERE stake_id = ?")
        .run(remaining, rewardDebtFor(remaining, state.accRewardPerShare), stake.stake_id);
    }
    persistFarmMeta(farmId, state);
    getDb()
      .prepare("UPDATE dex_farms SET total_staked = total_staked - ?, updated_at = datetime('now') WHERE farm_id = ?")
      .run(amount, farmId);
    return { farmId, remaining, pending };
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
    .get(farmId, userId) as { stake_id: string; amount: number; reward_debt: number } | undefined;
  if (!stake) throw new DexError('NO_STAKE', 'no stake in this farm', 404);

  return getDb().transaction(() => {
    const state = currentFarmState(farm);
    const pending = pendingFarmRewards(stake.amount, state.accRewardPerShare, stake.reward_debt);
    if (pending <= 0) return 0;
    creditAvailable(userId, farm.reward_token, pending);
    recordTransaction(userId, 'dex_farm_reward', farm.reward_token, pending, 0, 'completed', `farm ${farmId}`);
    getDb()
      .prepare("UPDATE dex_farm_stakes SET reward_debt = ?, updated_at = datetime('now') WHERE stake_id = ?")
      .run(rewardDebtFor(stake.amount, state.accRewardPerShare), stake.stake_id);
    persistFarmMeta(farmId, state);
    return pending;
  })() as number;
}

/** A user's farm positions with their live pending rewards. */
export function farmPositions(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare(
      `SELECT s.*, f.name, f.reward_token, f.reward_rate, f.apr, f.boost_multiplier, f.status AS farm_status, f.pool_id
         FROM dex_farm_stakes s JOIN dex_farms f ON f.farm_id = s.farm_id
        WHERE s.user_id = ?`,
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const farm = loadFarmRow(String(row.farm_id));
    const state = farm ? currentFarmState(farm) : null;
    const pending = state
      ? pendingFarmRewards(Number(row.amount), state.accRewardPerShare, Number(row.reward_debt))
      : 0;
    return {
      farmId: row.farm_id,
      name: row.name,
      poolId: row.pool_id,
      staked: row.amount,
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
  if (new Date(lock.unlock_at).getTime() > nowMs()) {
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
  const bribeId = generateId();
  getDb()
    .prepare('INSERT INTO dex_bribes (bribe_id, gauge_id, token, amount, sponsor, epoch) VALUES (?, ?, ?, ?, ?, ?)')
    .run(bribeId, gaugeId, token.toUpperCase(), amount, sponsor, currentEpoch());
  return bribeId;
}
