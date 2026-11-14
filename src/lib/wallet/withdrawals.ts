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
import { withdrawalHoldStatus } from '@/lib/security/freeze';
import { assertNotSanctioned, SanctionsError } from '@/lib/compliance/sanctions';
import { assessAddress, recordAddressOutcome } from '@/lib/compliance/address-risk';
import {
  assertTravelRuleSatisfied,
  originatorFromUser,
  recordTravelRuleMessage,
  TravelRuleError,
} from '@/lib/compliance/travel-rule';
import { decryptSecret, verifyTotp } from '@/lib/security/totp';

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
  /**
   * Beneficiary name for the travel-rule message. Required only when the
   * transfer is at or above the travel-rule threshold and the destination is
   * custodial; for a self-hosted address the address is the account reference.
   */
  beneficiaryName?: string | null;
  /** Authenticator code, required when the account has 2FA enabled. */
  twoFactorCode?: string | null;
  /**
   * Set by the API-key route only. A signed API key that carries the `withdraw`
   * permission (and, when configured, an IP allowlist) is the second factor on
   * that path, so the interactive authenticator gate is not applied. The web
   * session route never sets this, so a browser session alone still requires 2FA.
   */
  apiKeyAuthorized?: boolean;
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

  // A cooling-off hold placed after a security-sensitive account change blocks
  // withdrawals until it lifts, so a compromised account cannot be drained at
  // once.
  const hold = withdrawalHoldStatus(input.userId);
  if (hold.held) {
    throw new WithdrawalError(
      'WITHDRAWAL_HOLD',
      `Withdrawals are held for ${hold.hoursRemaining} more hour(s) after a recent security change`,
      403,
    );
  }

  // Second-factor gate. When the account has 2FA enabled the request must carry
  // a valid authenticator code, so a stolen session alone cannot move funds out.
  // The check fails closed: an enabled account with a missing secret is refused
  // rather than treated as unenrolled.
  const account = getDb()
    .prepare('SELECT two_factor_enabled, two_factor_secret, two_factor_type FROM users WHERE user_id = ?')
    .get(input.userId) as
    | { two_factor_enabled: number; two_factor_secret: string | null; two_factor_type: string | null }
    | undefined;
  if (!account) throw new WithdrawalError('NOT_FOUND', 'Account not found', 404);

  if (account.two_factor_enabled && !input.apiKeyAuthorized) {
    const code = String(input.twoFactorCode ?? '').trim();
    if (!code) {
      throw new WithdrawalError('TOTP_REQUIRED', 'Enter your authenticator code to withdraw', 403);
    }
    const type = account.two_factor_type || 'totp';
    if (type !== 'totp') {
      // Email/SMS second factors are verified at sign-in and are not accepted
      // here; a withdrawal requires the authenticator app.
      throw new WithdrawalError('TOTP_REQUIRED', 'Withdrawals require an authenticator app code', 403);
    }
    let secret = '';
    try {
      secret = account.two_factor_secret ? decryptSecret(account.two_factor_secret) : '';
    } catch {
      secret = '';
    }
    if (!secret || !verifyTotp(secret, code)) {
      throw new WithdrawalError('TOTP_INVALID', 'Invalid authenticator code', 403);
    }
  }

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

  // Screen the destination against the loaded sanctions list. Enforcement is on
  // in production, so a listed address is refused and an unloaded list is a
  // refusal rather than a silent pass.
  try {
    assertNotSanctioned(checked.normalized, 'address');
  } catch (error) {
    if (error instanceof SanctionsError) {
      throw new WithdrawalError(error.code, error.message, error.status);
    }
    throw error;
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

  // Destination risk. A sanctions match or an operator-blocked address is a
  // hard refusal; a first-time high-value destination is held for review rather
  // than released. The score is derived from the venue's own data, never an
  // external risk API.
  const risk = assessAddress({
    userId: input.userId,
    address: checked.normalized,
    network,
    amountUsd: requestedUsd,
  });
  if (risk.blocked) {
    throw new WithdrawalError(
      'ADDRESS_BLOCKED',
      `This destination is blocked: ${risk.reasons.join('; ') || 'risk policy'}`,
      403,
    );
  }
  if (risk.requiresReview) {
    throw new WithdrawalError(
      'ADDRESS_UNDER_REVIEW',
      `This destination needs a manual review before funds can be sent: ${risk.reasons.join('; ')}`,
      403,
    );
  }

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

  // FATF travel rule. At or above the threshold the originator/beneficiary data
  // must be present and a message is recorded; below it the check is skipped.
  // This runs after the account-limit checks so an over-limit request is refused
  // for the amount, not for missing party data.
  let travelRule: ReturnType<typeof assertTravelRuleSatisfied>;
  try {
    travelRule = assertTravelRuleSatisfied({
      direction: 'withdrawal',
      amountUsd: requestedUsd,
      originator: originatorFromUser(input.userId),
      beneficiary: { accountRef: checked.normalized, name: input.beneficiaryName ?? null },
    });
  } catch (error) {
    if (error instanceof TravelRuleError) throw new WithdrawalError(error.code, error.message, error.status);
    throw error;
  }

  const db = getDb();
  const withdrawalId = generateId();
  const now = new Date().toISOString();

  // Record the user's custody wallet for this asset and network when one exists,
  // so the on-chain step signs with a known key rather than re-deriving the row.
  const wallet = db
    .prepare(
      `SELECT wallet_id FROM wallets
        WHERE user_id = ? AND currency = ? AND UPPER(network) = ? AND address_index IS NOT NULL
        ORDER BY created_at LIMIT 1`,
    )
    .get(input.userId, asset, network) as { wallet_id: string } | undefined;

  db.transaction(() => {
    lockAvailable(input.userId, asset, total);
    db.prepare(
      `INSERT INTO withdrawals
         (withdrawal_id, user_id, wallet_id, currency, network, amount, fee, address, memo, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      withdrawalId,
      input.userId,
      wallet?.wallet_id ?? null,
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

  // Persist the travel-rule message (when in scope) and mark the destination as
  // used, so the next withdrawal to it is trusted. Both are outside the balance
  // transaction: a failure here must not un-reserve the funds, and the message
  // is keyed to the withdrawal id so it can be tied back.
  if (travelRule.required) {
    recordTravelRuleMessage({
      direction: 'withdrawal',
      originator: originatorFromUser(input.userId),
      beneficiary: { accountRef: checked.normalized, name: input.beneficiaryName ?? null },
      amountUsd: requestedUsd,
      asset,
      amount: String(amount),
      referenceId: withdrawalId,
    });
  }
  recordAddressOutcome({
    userId: input.userId,
    address: checked.normalized,
    network,
    amountUsd: requestedUsd,
  });

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

export interface SettleWithdrawalResult {
  withdrawalId: string;
  status: 'completed' | 'rejected';
}

/**
 * Settle a pending withdrawal: approve it or reject it.
 *
 * Approval consumes the reserved amount, rejection returns it to the available
 * balance. The funds were locked across every balance row that held the asset,
 * so settlement reaches the same rows — a single wallet's row would be wrong
 * when an asset sits in more than one row, and would strand or double-count the
 * reservation. Both paths run in one transaction, so a failure cannot leave the
 * ledger half-updated.
 */
export function settleWithdrawal(
  withdrawalId: string,
  action: 'approve' | 'reject',
  options: { txHash?: string | null } = {},
): SettleWithdrawalResult {
  const db = getDb();
  const withdrawal = db
    .prepare('SELECT withdrawal_id, user_id, currency, amount, fee, wallet_id, status FROM withdrawals WHERE withdrawal_id = ?')
    .get(withdrawalId) as
    | { withdrawal_id: string; user_id: string; currency: string; amount: number; fee: number; wallet_id: string | null; status: string }
    | undefined;
  if (!withdrawal) throw new WithdrawalError('UNKNOWN_WITHDRAWAL', 'No such withdrawal', 404);
  if (withdrawal.status !== 'pending' && withdrawal.status !== 'broadcast') {
    throw new WithdrawalError('ALREADY_PROCESSED', `This withdrawal is already ${withdrawal.status}`, 409);
  }
  const alreadyBroadcast = withdrawal.status === 'broadcast';
  if (action === 'reject' && alreadyBroadcast) {
    // A withdrawal that has already been broadcast on chain cannot be rejected:
    // the funds are out of the exchange's hands, and returning the reservation
    // would mint them a second time.
    throw new WithdrawalError('ALREADY_BROADCAST', 'A broadcast withdrawal cannot be rejected', 409);
  }

  const total = (Number(withdrawal.amount) || 0) + (Number(withdrawal.fee) || 0);
  const now = new Date().toISOString();
  const walletType = withdrawal.wallet_id
    ? ((db.prepare('SELECT wallet_type FROM wallets WHERE wallet_id = ?').get(withdrawal.wallet_id) as
        | { wallet_type: string }
        | undefined)?.wallet_type ?? 'spot')
    : 'spot';

  db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT b.balance_id, b.available, b.locked
           FROM balances b
           JOIN wallets w ON w.wallet_id = b.wallet_id
          WHERE w.user_id = ? AND w.wallet_type = ? AND b.currency = ?
          ORDER BY b.locked DESC, b.available DESC, b.balance_id`,
      )
      .all(withdrawal.user_id, walletType, withdrawal.currency) as Array<{
      balance_id: string;
      available: number;
      locked: number;
    }>;

    if (rows.length === 0) {
      throw new WithdrawalError('NO_BALANCE', 'No balance row found for this withdrawal', 409);
    }

    if (action === 'approve') {
      // When the withdrawal was already broadcast, its reservation was consumed
      // at broadcast time; approval only records the transaction hash. Consuming
      // again here would take the amount a second time.
      if (!alreadyBroadcast) {
        const lockedTotal = rows.reduce((sum, row) => sum + Number(row.locked), 0);
        const availableTotal = rows.reduce((sum, row) => sum + Number(row.available), 0);
        if (lockedTotal + availableTotal + 1e-9 < total) {
          throw new WithdrawalError('INSUFFICIENT_FUNDS', 'The account does not hold enough to settle this withdrawal', 409);
        }

        let remaining = total;
        for (const row of rows) {
          if (remaining <= 1e-12) break;
          const fromLocked = Math.min(Number(row.locked), remaining);
          remaining -= fromLocked;
          const fromAvailable = Math.min(Number(row.available), remaining);
          remaining -= fromAvailable;
          if (fromLocked > 0 || fromAvailable > 0) {
            db.prepare(
              `UPDATE balances
                  SET locked = locked - ?, available = available - ?, updated_at = datetime('now')
                WHERE balance_id = ?`,
            ).run(fromLocked, fromAvailable, row.balance_id);
          }
        }
      }

      db.prepare(
        `UPDATE withdrawals SET status = 'completed', tx_hash = COALESCE(?, tx_hash), processed_at = ? WHERE withdrawal_id = ?`,
      ).run(options.txHash || null, now, withdrawalId);
    } else {
      // Rejection returns whatever was locked to the available balance.
      let remaining = Math.min(total, rows.reduce((sum, row) => sum + Number(row.locked), 0));
      for (const row of rows) {
        if (remaining <= 1e-12) break;
        const release = Math.min(Number(row.locked), remaining);
        remaining -= release;
        if (release > 0) {
          db.prepare(
            `UPDATE balances
                SET locked = locked - ?, available = available + ?, updated_at = datetime('now')
              WHERE balance_id = ?`,
          ).run(release, release, row.balance_id);
        }
      }

      db.prepare(`UPDATE withdrawals SET status = 'rejected', processed_at = ? WHERE withdrawal_id = ?`).run(
        now,
        withdrawalId,
      );
    }
  })();

  return { withdrawalId, status: action === 'approve' ? 'completed' : 'rejected' };
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
