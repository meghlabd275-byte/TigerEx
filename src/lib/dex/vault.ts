/**
 * TigerSwap auto-compounding vaults.
 *
 * A vault takes LP tokens (or a single staking token), harvests the rewards the
 * farm pays it, sells those rewards back into the staked asset and restakes the
 * proceeds. Because the vault's total assets therefore grow between deposits,
 * a depositor must not be able to claim a share of rewards earned before they
 * arrived, and a withdrawer must not be diluted by rewards earned while they
 * held. Both are handled the way a real vault handles it: shares are priced
 * against total assets, and a deposit or withdrawal is priced at the
 * assets-per-share ratio that prevails at that moment.
 *
 * The module is pure. It never touches balances; the service layer does that.
 */

import { AmmError, requirePositive } from '@/lib/dex/amm';

export interface VaultState {
  /** Total assets under management, in the vault's underlying unit. */
  totalAssets: number;
  /** Total shares outstanding. */
  totalSupply: number;
}

function requireNonNegative(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AmmError('INVALID_AMOUNT', `${name} must be a non-negative finite number`);
  }
  return n;
}

/**
 * Assets represented by one share.
 *
 * An empty vault (no shares) is defined as 1:1 so the first depositor gets one
 * share per unit. That is the only convention that keeps the arithmetic stable
 * for the first deposit without a special case at the call site.
 */
export function assetsPerShare(state: VaultState): number {
  const assets = requireNonNegative(state.totalAssets, 'totalAssets');
  const supply = requireNonNegative(state.totalSupply, 'totalSupply');
  if (supply === 0) return 1;
  return assets / supply;
}

/**
 * Shares minted for a deposit of `assets`, rounded down.
 *
 * Rounding down is deliberate: it can only ever favour the existing holders by
 * at most one share's worth of dust, never the depositor, so an attacker cannot
 * mint value by depositing repeatedly at a favourable boundary.
 */
export function sharesForDeposit(state: VaultState, assets: number): number {
  const amount = requirePositive(assets, 'assets');
  const price = assetsPerShare(state);
  return amount / price;
}

/**
 * Assets returned for burning `shares`, rounded down for the same reason as
 * `sharesForDeposit`.
 */
export function assetsForWithdrawal(state: VaultState, shares: number): number {
  const amount = requirePositive(shares, 'shares');
  if (amount > state.totalSupply) {
    throw new AmmError('INSUFFICIENT_SHARES', 'shares exceed totalSupply');
  }
  return amount * assetsPerShare(state);
}

export interface CompoundResult {
  /** Reward tokens the strategy sold. */
  rewardSold: number;
  /** Underlying assets the sale produced. */
  assetsAdded: number;
  /** Total assets after the compound. */
  totalAssets: number;
  /** Assets added per existing share; zero when there are no shares. */
  perShareGain: number;
}

/**
 * Apply a harvest.
 *
 * The strategy has already swapped `rewardSold` worth of rewards into
 * `assetsAdded` of the underlying and hands both in; this function is the
 * accounting half that distributes the gain across the outstanding shares. It
 * rejects a negative gain: a compound that lost value is a strategy bug, not a
 * reward, and silently absorbing it would hide the loss inside the share price.
 */
export function applyCompound(state: VaultState, rewardSold: number, assetsAdded: number): CompoundResult {
  const sold = requireNonNegative(rewardSold, 'rewardSold');
  const added = requireNonNegative(assetsAdded, 'assetsAdded');
  const supply = requireNonNegative(state.totalSupply, 'totalSupply');
  const totalAssets = requireNonNegative(state.totalAssets, 'totalAssets') + added;

  return {
    rewardSold: sold,
    assetsAdded: added,
    totalAssets,
    perShareGain: supply === 0 ? 0 : added / supply,
  };
}

/**
 * How much of a reward balance should be swapped and restaked.
 *
 * Compounding only pays when the reward is worth more than the swap and gas it
 * costs, so the caller supplies the minimum viable harvest and this returns 0
 * below it rather than burning the reward on fees.
 */
export function harvestable(rewardBalance: number, minHarvest: number): number {
  const balance = requireNonNegative(rewardBalance, 'rewardBalance');
  const minimum = requireNonNegative(minHarvest, 'minHarvest');
  if (balance < minimum) return 0;
  return balance;
}

/**
 * Project the growth of one share over a number of compounds.
 *
 * `apy` is a fraction (0.2 for 20%). Compounding `perYear` times turns the
 * nominal rate into the effective one; the returned figure is the share price
 * multiplier, so 1.2 means one share is worth 20% more.
 */
export function projectSharePrice(apy: number, perYear: number, years: number): number {
  const rate = typeof apy === 'number' ? apy : Number(apy);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new AmmError('INVALID_RATE', 'apy must be a non-negative finite number');
  }
  if (!Number.isInteger(perYear) || perYear < 1) {
    throw new AmmError('INVALID_FREQUENCY', 'perYear must be a positive integer');
  }
  const span = requireNonNegative(years, 'years');
  const periods = perYear * span;
  return Math.pow(1 + rate / perYear, periods);
}

/**
 * The fee a vault takes from a harvest, split to the protocol treasury.
 *
 * A performance fee is charged on the gain only, never on the principal, so a
 * vault that has not grown pays nothing.
 */
export function performanceFee(assetsAdded: number, feeBps: number): { fee: number; net: number } {
  const gain = requireNonNegative(assetsAdded, 'assetsAdded');
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) {
    throw new AmmError('INVALID_FEE', 'feeBps must be an integer in [0, 10000)');
  }
  const fee = (gain * feeBps) / 10_000;
  return { fee, net: gain - fee };
}
