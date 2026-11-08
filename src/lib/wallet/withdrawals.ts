/**
 * Withdrawal policy: per-network fees and KYC-based limits.
 *
 * Fees and minimums are operator policy stored in `system_settings` under
 * `withdrawal_fees`, keyed by `ASSET:NETWORK`. A currency with no configured
 * entry is treated as not withdrawable rather than being given an invented
 * fee, so enabling a chain is a deliberate administrative act.
 *
 * The limits are the same `kyc_limit_level_<n>` values the KYC console edits,
 * measured against the user's own settled withdrawals.
 */

import { getDb, generateId } from '@/lib/db';
import { lockAvailable, recordTransaction } from '@/lib/db/ledger';
import { validateAddress } from '@/lib/wallet/address';

export interface WithdrawalPolicy {
  asset: string;
  network: string;
  fee: number;
  minAmount: number;
  maxAmount: number | null;
  enabled: boolean;
}

export interface KycLimit {
  level: number;
  dailyWithdrawalUsd: number;
  monthlyWithdrawalUsd: number;
}

const DEFAULT_LIMITS: KycLimit[] = [
  { level: 0, dailyWithdrawalUsd: 10000, monthlyWithdrawalUsd: 20000 },
  { level: 1, dailyWithdrawalUsd: 100000, monthlyWithdrawalUsd: 500000 },
  { level: 2, dailyWithdrawalUsd: 1000000, monthlyWithdrawalUsd: 5000000 },
  { level: 3, dailyWithdrawalUsd: 10000000, monthlyWithdrawalUsd: 50000000 },
];

export const WITHDRAWAL_FEES_KEY = 'withdrawal_fees';

function readSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/**
 * The configured withdrawal policies.
 *
 * A malformed entry is skipped rather than defaulted, so a typo in the console
 * cannot silently enable a chain with a zero fee.
 */
export function withdrawalPolicies(): WithdrawalPolicy[] {
  const raw = readSetting(WITHDRAWAL_FEES_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object') return [];

  const policies: WithdrawalPolicy[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    const [asset, network] = key.split(':');
    if (!asset || !network) continue;

    const fee = Number(entry.fee ?? 0);
    const minAmount = Number(entry.minAmount ?? 0);
    if (!Number.isFinite(fee) || fee < 0) continue;
    if (!Number.isFinite(minAmount) || minAmount < 0) continue;

    const maxRaw = entry.maxAmount === null || entry.maxAmount === undefined ? null : Number(entry.maxAmount);
    const maxAmount = maxRaw !== null && Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : null;

    policies.push({
      asset: asset.trim().toUpperCase(),
      network: network.trim().toUpperCase(),
      fee,
      minAmount,
      maxAmount,
      enabled: entry.enabled !== false,
    });
  }
  return policies;
}

/** The policy for one asset on one network, or null when the chain is disabled. */
export function withdrawalPolicy(asset: string, network: string): WithdrawalPolicy | null {
  const upperAsset = String(asset).trim().toUpperCase();
  const upperNetwork = String(network).trim().toUpperCase();
  return (
    withdrawalPolicies().find(
      (policy) => policy.asset === upperAsset && policy.network === upperNetwork && policy.enabled,
    ) ?? null
  );
}

/** The KYC withdrawal limits, as configured by the compliance console. */
export function kycLimits(): KycLimit[] {
  const rows = getDb()
    .prepare("SELECT key, value FROM system_settings WHERE key LIKE 'kyc_limit_level_%'")
    .all() as Array<{ key: string; value: string }>;

  const stored = new Map(rows.map((row) => [row.key, row.value]));
  return DEFAULT_LIMITS.map((tier) => {
    const raw = stored.get(`kyc_limit_level_${tier.level}`);
    if (!raw) return tier;
    try {
      const parsed = JSON.parse(raw) as Partial<KycLimit>;
      const daily = Number(parsed.dailyWithdrawalUsd);
      const monthly = Number(parsed.monthlyWithdrawalUsd);
      return {
        level: tier.level,
        dailyWithdrawalUsd: Number.isFinite(daily) ? daily : tier.dailyWithdrawalUsd,
        monthlyWithdrawalUsd: Number.isFinite(monthly) ? monthly : tier.monthlyWithdrawalUsd,
      };
    } catch {
      return tier;
    }
  });
}

/** The limit tier for a KYC level string such as `none`, `1` or `2`. */
export function limitForLevel(kycLevel: string): KycLimit {
  const limits = kycLimits();
  const parsed = kycLevel === 'none' || kycLevel === '' ? 0 : Number(kycLevel);
  const level = Number.isInteger(parsed) ? parsed : 0;
  return limits.find((tier) => tier.level === level) ?? limits[0];
}

export interface WithdrawalUsage {
  dailyUsd: number;
  monthlyUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  remainingDailyUsd: number;
  remainingMonthlyUsd: number;
}

/**
 * The user's settled withdrawal volume in the current day and month.
 *
 * Only withdrawals that were actually paid out count against the limit, so a
 * rejected request does not consume the user's quota.
 */
export function withdrawalUsage(userId: string, kycLevel: string, usdPrice: (asset: string) => number | null): WithdrawalUsage {
  const limit = limitForLevel(kycLevel);
  const rows = getDb()
    .prepare(
      `SELECT currency, amount, fee, created_at
         FROM withdrawals
        WHERE user_id = ? AND status IN ('completed', 'processing', 'pending')
          AND created_at >= datetime('now', '-31 day')`,
    )
    .all(userId) as Array<{ currency: string; amount: number; fee: number; created_at: string }>;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  let dailyUsd = 0;
  let monthlyUsd = 0;
  for (const row of rows) {
    const price = usdPrice(row.currency);
    if (price === null) continue; // an unpriced asset cannot be measured against a USD cap
    const value = (Number(row.amount) || 0) * price;
    const at = Date.parse(`${String(row.created_at).replace(' ', 'T')}Z`);
    if (!Number.isFinite(at)) continue;
    if (at >= monthStart.getTime()) monthlyUsd += value;
    if (at >= dayStart.getTime()) dailyUsd += value;
  }

  return {
    dailyUsd,
    monthlyUsd,
    dailyLimitUsd: limit.dailyWithdrawalUsd,
    monthlyLimitUsd: limit.monthlyWithdrawalUsd,
    remainingDailyUsd: Math.max(0, limit.dailyWithdrawalUsd - dailyUsd),
    remainingMonthlyUsd: Math.max(0, limit.monthlyWithdrawalUsd - monthlyUsd),
  };
}

/** The address book / whitelist entries for a user. */
export function addressBook(userId: string, asset?: string): Array<{
  id: string;
  asset: string;
  network: string;
  address: string;
  label: string | null;
  status: string;
  createdAt: string;
}> {
  const clauses = ['user_id = ?'];
  const params: string[] = [userId];
  if (asset) {
    clauses.push('asset = ?');
    params.push(asset.trim().toUpperCase());
  }

  const rows = getDb()
    .prepare(
      `SELECT entry_id, asset, network, address, label, status, created_at
         FROM withdrawal_whitelist
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, entry_id DESC`,
    )
    .all(...params) as Array<{
    entry_id: string;
    asset: string;
    network: string;
    address: string;
    label: string | null;
    status: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.entry_id,
    asset: row.asset,
    network: row.network,
    address: row.address,
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/** Whether withdrawals are open exchange-wide. */
export function withdrawalsEnabled(): { enabled: boolean; reason: string | null } {
  const db = getDb();
  const control = db
    .prepare("SELECT paused, reason FROM exchange_controls WHERE scope = 'withdrawals'")
    .get() as { paused: number; reason: string | null } | undefined;
  if (control && Number(control.paused) === 1) {
    return { enabled: false, reason: control.reason || 'Withdrawals are paused' };
  }

  const setting = db
    .prepare("SELECT value FROM system_settings WHERE key = 'withdrawal_enabled'")
    .get() as { value: string } | undefined;
  if (setting && setting.value === 'false') {
    return { enabled: false, reason: 'Withdrawals are disabled' };
  }
  return { enabled: true, reason: null };
}

/**
 * Whether the account has turned on withdrawal-address locking.
 *
 * A missing user row is treated as off, matching the column default, so an
 * unknown account cannot silently bypass the check.
 */
export function withdrawalWhitelistEnabled(userId: string): boolean {
  const row = getDb()
    .prepare('SELECT withdrawal_whitelist_enabled FROM users WHERE user_id = ?')
    .get(userId) as { withdrawal_whitelist_enabled: number } | undefined;
  return Number(row?.withdrawal_whitelist_enabled ?? 0) === 1;
}

/** Whether an address is a saved, active entry in the account's address book. */
export function isWhitelistedAddress(userId: string, asset: string, network: string, address: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM withdrawal_whitelist
        WHERE user_id = ? AND asset = ? AND network = ? AND address = ? AND status = 'active'`,
    )
    .get(userId, asset, network, address);
  return Boolean(row);
}

export interface CreateWithdrawalInput {
  userId: string;
  kycLevel: string;
  asset: string;
  network: string;
  amount: number;
  fee: number;
  address: string;
  memo?: string | null;
  usdPrice: (asset: string) => number | null;
}

export interface CreateWithdrawalResult {
  withdrawalId: string;
  asset: string;
  network: string;
  amount: number;
  fee: number;
  total: number;
  address: string;
  status: string;
}

export class WithdrawalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Create a pending withdrawal, reserving the funds.
 *
 * The request is refused unless the chain is configured, the address passes its
 * network's real checksum, the amount is within the chain's minimum and maximum
 * and the user's KYC tier still has daily and monthly headroom. The amount plus
 * the fee is locked in one ledger transaction, so the funds cannot be spent
 * while the request is pending and a rejection returns them intact.
 */
export function createWithdrawal(input: CreateWithdrawalInput): CreateWithdrawalResult {
  const asset = String(input.asset ?? '').trim().toUpperCase();
  const network = String(input.network ?? '').trim().toUpperCase();
  const amount = Number(input.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new WithdrawalError('INVALID_AMOUNT', 'Amount must be a positive number');
  }
  if (!asset || !network) {
    throw new WithdrawalError('VALIDATION_FAILED', 'Asset and network are required');
  }

  const gate = withdrawalsEnabled();
  if (!gate.enabled) throw new WithdrawalError('WITHDRAWALS_PAUSED', gate.reason ?? 'Withdrawals are paused', 503);

  const policy = withdrawalPolicy(asset, network);
  if (!policy) {
    throw new WithdrawalError(
      'CHAIN_NOT_CONFIGURED',
      `Withdrawals of ${asset} on ${network} are not enabled`,
      409,
    );
  }

  const checked = validateAddress(network, input.address ?? '');
  if (!checked.valid || !checked.normalized) {
    throw new WithdrawalError('INVALID_ADDRESS', checked.reason ?? 'The withdrawal address is not valid');
  }

  if (
    withdrawalWhitelistEnabled(input.userId) &&
    !isWhitelistedAddress(input.userId, asset, network, checked.normalized)
  ) {
    throw new WithdrawalError(
      'ADDRESS_NOT_WHITELISTED',
      'Withdrawal address locking is on, so this address must be saved in your address book first',
      403,
    );
  }

  if (amount < policy.minAmount) {
    throw new WithdrawalError(
      'BELOW_MINIMUM',
      `The minimum ${asset} withdrawal on ${network} is ${policy.minAmount}`,
    );
  }
  if (policy.maxAmount !== null && amount > policy.maxAmount) {
    throw new WithdrawalError(
      'ABOVE_MAXIMUM',
      `The maximum ${asset} withdrawal on ${network} is ${policy.maxAmount}`,
    );
  }

  const fee = Number(input.fee);
  if (!Number.isFinite(fee) || fee < 0) {
    throw new WithdrawalError('INVALID_FEE', 'The withdrawal fee is not valid');
  }

  const total = amount + fee;
  const unit = input.usdPrice(asset);
  if (unit === null) {
    throw new WithdrawalError('UNPRICED_ASSET', `${asset} has no price, so the withdrawal limit cannot be checked`, 409);
  }

  const usage = withdrawalUsage(input.userId, input.kycLevel, input.usdPrice);
  const requestedUsd = total * unit;
  if (usage.dailyUsd + requestedUsd > usage.dailyLimitUsd) {
    throw new WithdrawalError(
      'DAILY_LIMIT_EXCEEDED',
      `This withdrawal exceeds the remaining daily limit of ${Math.max(0, usage.remainingDailyUsd).toFixed(2)} USD for your verification level`,
      409,
    );
  }
  if (usage.monthlyUsd + requestedUsd > usage.monthlyLimitUsd) {
    throw new WithdrawalError(
      'MONTHLY_LIMIT_EXCEEDED',
      `This withdrawal exceeds the remaining monthly limit of ${Math.max(0, usage.remainingMonthlyUsd).toFixed(2)} USD for your verification level`,
      409,
    );
  }

  const db = getDb();
  const withdrawalId = generateId();
  const now = new Date().toISOString();

  db.transaction(() => {
    lockAvailable(input.userId, asset, total);
    db.prepare(
      `INSERT INTO withdrawals
         (withdrawal_id, user_id, wallet_id, currency, network, amount, fee, address, memo, status, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      withdrawalId,
      input.userId,
      asset,
      network,
      amount,
      fee,
      checked.normalized,
      input.memo ? String(input.memo).slice(0, 128) : null,
      now,
    );
    recordTransaction(input.userId, 'withdrawal', asset, total, 0, 'pending', `Withdrawal ${withdrawalId}`);
  })();

  return {
    withdrawalId,
    asset,
    network,
    amount,
    fee,
    total,
    address: checked.normalized,
    status: 'pending',
  };
}

/** A user's withdrawal history, newest first. */
export function userWithdrawals(
  userId: string,
  options: { asset?: string; status?: string; limit?: number } = {},
): Array<Record<string, unknown>> {
  const clauses = ['user_id = ?'];
  const params: Array<string | number> = [userId];
  if (options.asset) {
    clauses.push('currency = ?');
    params.push(options.asset.trim().toUpperCase());
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status.trim().toLowerCase());
  }
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100) || 100, 1), 500);

  const rows = getDb()
    .prepare(
      `SELECT withdrawal_id, currency, network, amount, fee, address, memo, tx_hash, status, created_at, processed_at
         FROM withdrawals
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, withdrawal_id DESC
        LIMIT ?`,
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.withdrawal_id,
    withdrawal_id: row.withdrawal_id,
    coin: row.currency,
    asset: row.currency,
    network: row.network,
    amount: Number(row.amount) || 0,
    fee: Number(row.fee) || 0,
    address: row.address,
    memo: row.memo ?? null,
    txHash: row.tx_hash ?? null,
    txid: row.tx_hash ?? null,
    status: row.status,
    created_at: row.created_at,
    createdAt: row.created_at,
    processed_at: row.processed_at ?? null,
  }));
}

/** A user's deposit history, newest first. */
export function userDeposits(
  userId: string,
  options: { asset?: string; status?: string; limit?: number } = {},
): Array<Record<string, unknown>> {
  const clauses = ['user_id = ?'];
  const params: Array<string | number> = [userId];
  if (options.asset) {
    clauses.push('currency = ?');
    params.push(options.asset.trim().toUpperCase());
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status.trim().toLowerCase());
  }
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100) || 100, 1), 500);

  const rows = getDb()
    .prepare(
      `SELECT deposit_id, currency, network, amount, tx_hash, address, confirmations,
              required_confirmations, status, created_at, credited_at
         FROM deposits
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, deposit_id DESC
        LIMIT ?`,
    )
    .all(...params, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.deposit_id,
    deposit_id: row.deposit_id,
    coin: row.currency,
    asset: row.currency,
    network: row.network,
    amount: Number(row.amount) || 0,
    txHash: row.tx_hash ?? null,
    txid: row.tx_hash ?? null,
    address: row.address ?? null,
    confirmations: Number(row.confirmations) || 0,
    requiredConfirmations: Number(row.required_confirmations) || 0,
    status: row.status,
    created_at: row.created_at,
    createdAt: row.created_at,
    credited_at: row.credited_at ?? null,
  }));
}
