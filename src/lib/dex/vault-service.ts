/**
 * TigerSwap auto-compounding vault settlement.
 *
 * A vault holds staked LP tokens and periodically sells the farm rewards back
 * into the staked token. Deposits mint shares at the prevailing share price and
 * withdrawals burn them, so a depositor cannot claim rewards earned before they
 * arrived and an existing holder is not diluted by a late one.
 *
 * The share math lives in `vault.ts`; this module is the settlement half. It
 * moves real balances through the ledger, records the harvest in
 * `dex_vault_harvests` and credits the performance fee to the treasury.
 */

import { getDb, generateId } from '@/lib/db';
import { debitAvailable, creditAvailable, availableBalance, covers, recordTransaction } from '@/lib/db/ledger';
import { AmmError } from '@/lib/dex/amm';
import { DexError, dexSetting, assertDexOpen, recordDexRevenue } from '@/lib/dex/pool-service';
import {
  assetsPerShare,
  sharesForDeposit,
  assetsForWithdrawal,
  applyCompound,
  harvestable,
  performanceFee,
  type VaultState,
} from '@/lib/dex/vault';

interface VaultRow {
  vault_id: string;
  name: string;
  kind: string;
  pool_id: string;
  staked_token: string;
  reward_token: string;
  performance_fee_bps: number;
  min_harvest: number;
  total_assets: number;
  total_supply: number;
  status: string;
}

export interface VaultDetail {
  vaultId: string;
  name: string;
  kind: string;
  poolId: string;
  stakedToken: string;
  rewardToken: string;
  totalAssets: number;
  totalSupply: number;
  sharePrice: number;
  performanceFeeBps: number;
  minHarvest: number;
  status: string;
}

function loadVault(vaultId: string): VaultRow {
  const row = getDb().prepare('SELECT * FROM dex_vaults WHERE vault_id = ?').get(vaultId) as VaultRow | undefined;
  if (!row) throw new DexError('UNKNOWN_VAULT', `vault ${vaultId} does not exist`, 404);
  return row;
}

function stateOf(row: VaultRow): VaultState {
  return { totalAssets: Number(row.total_assets), totalSupply: Number(row.total_supply) };
}

function detailOf(row: VaultRow): VaultDetail {
  const state = stateOf(row);
  return {
    vaultId: row.vault_id,
    name: row.name,
    kind: row.kind,
    poolId: row.pool_id,
    stakedToken: row.staked_token,
    rewardToken: row.reward_token,
    totalAssets: state.totalAssets,
    totalSupply: state.totalSupply,
    sharePrice: assetsPerShare(state),
    performanceFeeBps: Number(row.performance_fee_bps),
    minHarvest: Number(row.min_harvest),
    status: row.status,
  };
}

export function listVaults(): VaultDetail[] {
  const rows = getDb().prepare('SELECT * FROM dex_vaults ORDER BY created_at DESC').all() as VaultRow[];
  return rows.map(detailOf);
}

export function vaultDetail(vaultId: string): VaultDetail {
  return detailOf(loadVault(vaultId));
}

export interface VaultDepositResult {
  positionId: string;
  vaultId: string;
  assets: number;
  shares: number;
  sharePrice: number;
}

/**
 * Deposit `assets` of the staked token and mint shares.
 *
 * The tokens leave the depositor's available balance and are held by the vault;
 * the vault's `total_assets` rises by the same amount, so the share price is
 * unchanged by the deposit itself — only a harvest moves it.
 */
export function depositVault(userId: string, vaultId: string, assets: number): VaultDepositResult {
  assertDexOpen('dex');
  const row = loadVault(vaultId);
  if (row.status !== 'active') throw new DexError('VAULT_PAUSED', 'the vault is not accepting deposits', 409);

  const amount = Number(assets);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DexError('INVALID_AMOUNT', 'assets must be a positive number', 400);
  }
  if (!covers(availableBalance(userId, row.staked_token), amount)) {
    throw new DexError('INSUFFICIENT_BALANCE', `Insufficient ${row.staked_token} balance`, 400);
  }

  const state = stateOf(row);
  let shares: number;
  try {
    shares = sharesForDeposit(state, amount);
  } catch (error) {
    throw new DexError('INVALID_AMOUNT', (error as AmmError).message, 400);
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new DexError('INVALID_AMOUNT', 'the deposit mints no shares', 400);
  }

  const db = getDb();
  const positionId = generateId();
  db.transaction(() => {
    debitAvailable(userId, row.staked_token, amount);
    recordTransaction(userId, 'dex_vault_deposit', row.staked_token, amount, 0, 'completed', `vault ${vaultId}`);
    db.prepare(
      `INSERT INTO dex_vault_positions (position_id, vault_id, user_id, shares)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(vault_id, user_id) DO UPDATE SET shares = shares + excluded.shares, updated_at = datetime('now')`,
    ).run(positionId, vaultId, userId, shares);
    db.prepare(
      "UPDATE dex_vaults SET total_assets = total_assets + ?, total_supply = total_supply + ?, updated_at = datetime('now') WHERE vault_id = ?",
    ).run(amount, shares, vaultId);
  })();

  return { positionId, vaultId, assets: amount, shares, sharePrice: assetsPerShare({ totalAssets: state.totalAssets + amount, totalSupply: state.totalSupply + shares }) };
}

export interface VaultWithdrawResult {
  vaultId: string;
  shares: number;
  assets: number;
}

/** Burn `shares` and return the underlying assets at the current share price. */
export function withdrawVault(userId: string, vaultId: string, shares: number): VaultWithdrawResult {
  const row = loadVault(vaultId);
  const db = getDb();
  const position = db
    .prepare('SELECT * FROM dex_vault_positions WHERE vault_id = ? AND user_id = ?')
    .get(vaultId, userId) as { position_id: string; shares: number } | undefined;
  if (!position) throw new DexError('NO_POSITION', 'no vault position', 404);

  const burn = Number(shares);
  if (!Number.isFinite(burn) || burn <= 0) throw new DexError('INVALID_AMOUNT', 'shares must be positive', 400);
  if (burn > Number(position.shares) + 1e-9) {
    throw new DexError('INSUFFICIENT_SHARES', 'more shares than the position holds', 400);
  }

  const state = stateOf(row);
  let assets: number;
  try {
    assets = assetsForWithdrawal(state, burn);
  } catch (error) {
    throw new DexError('INVALID_AMOUNT', (error as AmmError).message, 400);
  }
  if (assets > Number(row.total_assets) + 1e-9) {
    throw new DexError('VAULT_ILLIQUID', 'the vault cannot cover this withdrawal', 409);
  }

  db.transaction(() => {
    const remaining = Number(position.shares) - burn;
    if (remaining <= 1e-12) {
      db.prepare('DELETE FROM dex_vault_positions WHERE position_id = ?').run(position.position_id);
    } else {
      db.prepare("UPDATE dex_vault_positions SET shares = ?, updated_at = datetime('now') WHERE position_id = ?").run(
        remaining,
        position.position_id,
      );
    }
    db.prepare(
      "UPDATE dex_vaults SET total_assets = total_assets - ?, total_supply = total_supply - ?, updated_at = datetime('now') WHERE vault_id = ?",
    ).run(assets, burn, vaultId);

    creditAvailable(userId, row.staked_token, assets);
    recordTransaction(userId, 'dex_vault_withdraw', row.staked_token, assets, 0, 'completed', `vault ${vaultId}`);
  })();

  return { vaultId, shares: burn, assets };
}

export interface HarvestResult {
  vaultId: string;
  rewardSold: number;
  assetsAdded: number;
  performanceFee: number;
  sharePrice: number;
  skipped: boolean;
}

/**
 * Compound the rewards the vault is holding.
 *
 * `rewardAmount` and `assetsAdded` are what the strategy actually harvested and
 * swapped, so the accounting is driven by real token movement rather than by a
 * projected rate. The performance fee is taken from the gain and credited to the
 * treasury; the remainder lifts the share price for every holder. A harvest
 * below the vault's minimum is skipped rather than executed at a loss.
 */
export function harvestVault(vaultId: string, rewardAmount: number, assetsAdded: number): HarvestResult {
  const row = loadVault(vaultId);
  const reward = Number(rewardAmount);
  const added = Number(assetsAdded);
  if (!Number.isFinite(reward) || reward < 0) throw new DexError('INVALID_AMOUNT', 'rewardAmount must be non-negative', 400);
  if (!Number.isFinite(added) || added < 0) throw new DexError('INVALID_AMOUNT', 'assetsAdded must be non-negative', 400);

  const minimum = Number(row.min_harvest);
  const usable = harvestable(reward, minimum);
  if (usable === 0 || added === 0) {
    return {
      vaultId,
      rewardSold: 0,
      assetsAdded: 0,
      performanceFee: 0,
      sharePrice: assetsPerShare(stateOf(row)),
      skipped: true,
    };
  }

  const feeBps = Number(row.performance_fee_bps);
  const { fee, net } = performanceFee(added, feeBps);
  const state = stateOf(row);
  const compound = applyCompound(state, usable, net);

  const db = getDb();
  const sharePrice = compound.totalAssets / (state.totalSupply || 1);
  db.transaction(() => {
    db.prepare(
      "UPDATE dex_vaults SET total_assets = total_assets + ?, updated_at = datetime('now') WHERE vault_id = ?",
    ).run(net, vaultId);
    db.prepare(
      `INSERT INTO dex_vault_harvests (harvest_id, vault_id, reward_sold, assets_added, performance_fee, share_price)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(generateId(), vaultId, usable, net, fee, sharePrice);

    if (fee > 0) {
      // The performance fee is real value the vault produced, so it is recorded
      // through the shared revenue ledger and credited to the treasury.
      recordDexRevenue('dex_vault_fee', row.staked_token, fee, { lp: 0, vetgr: 0, treasury: fee, insurance: 0, burn: 0 }, `vault ${vaultId}`);
    }
  })();

  return { vaultId, rewardSold: usable, assetsAdded: net, performanceFee: fee, sharePrice, skipped: false };
}

/** A user's vault positions with the vault's current share price. */
export function vaultPositions(userId: string): Array<Record<string, unknown>> {
  const rows = getDb()
    .prepare(
      `SELECT p.*, v.name, v.staked_token, v.reward_token, v.total_assets, v.total_supply, v.performance_fee_bps
         FROM dex_vault_positions p JOIN dex_vaults v ON v.vault_id = p.vault_id
        WHERE p.user_id = ? ORDER BY p.created_at DESC`,
    )
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const state = { totalAssets: Number(row.total_assets), totalSupply: Number(row.total_supply) };
    const shares = Number(row.shares);
    return {
      positionId: row.position_id,
      vaultId: row.vault_id,
      name: row.name,
      stakedToken: row.staked_token,
      rewardToken: row.reward_token,
      shares,
      assets: shares * assetsPerShare(state),
      sharePrice: assetsPerShare(state),
      performanceFeeBps: Number(row.performance_fee_bps),
      createdAt: row.created_at,
    };
  });
}

/** Read a vault setting, so an operator can retune the vault without a deploy. */
export function vaultSetting(key: string, fallback: number): number {
  return dexSetting(key, fallback);
}
