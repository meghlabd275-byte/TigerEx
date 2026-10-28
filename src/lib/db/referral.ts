import { getDb, generateId, generateReferralCode } from '@/lib/db';

/**
 * Referral tiers. Commission rates are the share of the referee's trading fee
 * that the referrer earns, and the volume requirement is the referee-attributed
 * trading volume needed to reach the tier.
 */
export interface ReferralTier {
  name: string;
  requiredVolume: number;
  commissionRate: number; // fraction of trading fee, e.g. 0.20 = 20%
  minReferrals: number;
}

export const REFERRAL_TIERS: ReferralTier[] = [
  { name: 'Bronze', requiredVolume: 0, commissionRate: 0.2, minReferrals: 0 },
  { name: 'Silver', requiredVolume: 100_000, commissionRate: 0.3, minReferrals: 5 },
  { name: 'Gold', requiredVolume: 500_000, commissionRate: 0.4, minReferrals: 20 },
  { name: 'Platinum', requiredVolume: 2_000_000, commissionRate: 0.5, minReferrals: 50 },
];

export function tierForVolume(volume: number, referralCount: number): ReferralTier {
  let match = REFERRAL_TIERS[0];
  for (const tier of REFERRAL_TIERS) {
    if (volume >= tier.requiredVolume && referralCount >= tier.minReferrals) {
      match = tier;
    }
  }
  return match;
}

/**
 * Return the user's referral code, creating one on first access.
 *
 * Codes are unique across the users table; a collision retries with a fresh
 * code rather than failing, which matters once the namespace gets dense.
 */
export function ensureReferralCode(userId: string): string {
  const db = getDb();

  const existing = db
    .prepare('SELECT referral_code FROM users WHERE user_id = ?')
    .get(userId) as { referral_code: string | null } | undefined;
  if (!existing) throw new Error('user not found');
  if (existing.referral_code) return existing.referral_code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode();
    const clash = db.prepare('SELECT 1 FROM users WHERE referral_code = ?').get(code);
    if (clash) continue;
    db.prepare('UPDATE users SET referral_code = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(
      code,
      userId,
    );
    return code;
  }
  throw new Error('could not allocate a unique referral code');
}

/**
 * Attach a new user to the owner of `referralCode`.
 *
 * Called during registration. An unknown code is rejected so a typo is reported
 * to the registrant instead of silently dropping the referral.
 */
export function attachReferral(refereeId: string, referralCode: string): void {
  const db = getDb();
  const code = referralCode.trim().toUpperCase();
  if (!code) return;

  const referrer = db
    .prepare('SELECT user_id FROM users WHERE referral_code = ?')
    .get(code) as { user_id: string } | undefined;
  if (!referrer) throw new Error('Referral code is not valid');
  if (referrer.user_id === refereeId) throw new Error('You cannot refer yourself');

  db.prepare('UPDATE users SET referred_by = ? WHERE user_id = ?').run(referrer.user_id, refereeId);
  db.prepare(
    `INSERT INTO referrals (referral_id, referrer_id, referee_id, referral_code, status, tier)
     VALUES (?, ?, ?, ?, 'pending', 'Bronze')`,
  ).run(generateId(), referrer.user_id, refereeId, code);
}

export interface ReferralSummary {
  referralId: string;
  refereeId: string;
  username: string | null;
  status: string;
  tier: string;
  commissionEarned: number;
  currency: string;
  createdAt: string;
  activatedAt: string | null;
}

export interface ReferralStats {
  code: string;
  totalReferrals: number;
  activeReferrals: number;
  pendingReferrals: number;
  totalEarned: number;
  currency: string;
  currentTier: string;
  commissionRate: number;
  nextTier: string | null;
  nextTierVolumeRequirement: number | null;
  attributedVolume: number;
}

export function referralStats(userId: string): ReferralStats {
  const db = getDb();
  const code = ensureReferralCode(userId);

  const rows = db
    .prepare(
      `SELECT status, commission_earned, commission_currency
         FROM referrals WHERE referrer_id = ?`,
    )
    .all(userId) as Array<{ status: string; commission_earned: number; commission_currency: string }>;

  const totalReferrals = rows.length;
  const activeReferrals = rows.filter((r) => r.status === 'active').length;
  const pendingReferrals = rows.filter((r) => r.status === 'pending').length;
  const totalEarned = rows.reduce((sum, r) => sum + (r.commission_earned || 0), 0);

  const volumeRow = db
    .prepare(
      `SELECT COALESCE(SUM(trade_volume), 0) AS volume
         FROM referral_commissions WHERE referrer_id = ?`,
    )
    .get(userId) as { volume: number };

  const attributedVolume = volumeRow?.volume ?? 0;
  const tier = tierForVolume(attributedVolume, totalReferrals);
  const tierIndex = REFERRAL_TIERS.findIndex((t) => t.name === tier.name);
  const next = REFERRAL_TIERS[tierIndex + 1] ?? null;

  return {
    code,
    totalReferrals,
    activeReferrals,
    pendingReferrals,
    totalEarned,
    currency: rows[0]?.commission_currency || 'USDT',
    currentTier: tier.name,
    commissionRate: tier.commissionRate,
    nextTier: next?.name ?? null,
    nextTierVolumeRequirement: next?.requiredVolume ?? null,
    attributedVolume,
  };
}

export function listReferrals(userId: string, limit: number, offset: number): ReferralSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT r.referral_id, r.referee_id, u.username, r.status, r.tier,
              r.commission_earned, r.commission_currency, r.created_at, r.activated_at
         FROM referrals r
         LEFT JOIN users u ON u.user_id = r.referee_id
        WHERE r.referrer_id = ?
        ORDER BY r.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset) as Array<{
    referral_id: string;
    referee_id: string;
    username: string | null;
    status: string;
    tier: string;
    commission_earned: number;
    commission_currency: string;
    created_at: string;
    activated_at: string | null;
  }>;

  return rows.map((r) => ({
    referralId: r.referral_id,
    refereeId: r.referee_id,
    username: r.username,
    status: r.status,
    tier: r.tier,
    commissionEarned: r.commission_earned,
    currency: r.commission_currency,
    createdAt: r.created_at,
    activatedAt: r.activated_at,
  }));
}

export interface CommissionRecord {
  commissionId: string;
  referralId: string;
  refereeId: string;
  tradeVolume: number;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

export function listCommissions(userId: string, limit: number, offset: number): CommissionRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT commission_id, referral_id, referee_id, trade_volume, amount,
              currency, status, created_at, paid_at
         FROM referral_commissions
        WHERE referrer_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset) as Array<{
    commission_id: string;
    referral_id: string;
    referee_id: string;
    trade_volume: number;
    amount: number;
    currency: string;
    status: string;
    created_at: string;
    paid_at: string | null;
  }>;

  return rows.map((r) => ({
    commissionId: r.commission_id,
    referralId: r.referral_id,
    refereeId: r.referee_id,
    tradeVolume: r.trade_volume,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    createdAt: r.created_at,
    paidAt: r.paid_at,
  }));
}

/**
 * Record a trade by a referred user and credit the referrer's commission.
 *
 * `feeAmount` is the fee the referee paid; the referrer earns `commissionRate`
 * of it. Both the commission row and the running total on the referral are
 * written in one transaction so the ledger and the summary cannot diverge.
 */
export function recordReferredTrade(refereeId: string, volume: number, feeAmount: number): void {
  const db = getDb();
  const referral = db
    .prepare(
      `SELECT referral_id, referrer_id FROM referrals
        WHERE referee_id = ? AND status IN ('pending', 'active')`,
    )
    .get(refereeId) as { referral_id: string; referrer_id: string } | undefined;
  if (!referral) return;

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(trade_volume), 0) AS volume
         FROM referral_commissions WHERE referrer_id = ?`,
    )
    .get(referral.referrer_id) as { volume: number };
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?')
    .get(referral.referrer_id) as { n: number };

  const tier = tierForVolume(totals.volume + volume, count.n);
  const amount = Math.max(0, feeAmount) * tier.commissionRate;

  const credit = db.transaction(() => {
    db.prepare(
      `INSERT INTO referral_commissions
         (commission_id, referral_id, referrer_id, referee_id, trade_volume, amount, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, 'USDT', 'pending')`,
    ).run(generateId(), referral.referral_id, referral.referrer_id, refereeId, volume, amount);

    db.prepare(
      `UPDATE referrals
          SET commission_earned = commission_earned + ?,
              tier = ?,
              status = 'active',
              activated_at = COALESCE(activated_at, datetime('now'))
        WHERE referral_id = ?`,
    ).run(amount, tier.name, referral.referral_id);
  });
  credit();
}

/** Leaderboard of referrers ranked by commission earned. */
export function referralLeaderboard(limit: number): Array<{
  rank: number;
  username: string | null;
  referrals: number;
  earned: number;
}> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.username,
              COUNT(r.referral_id) AS referrals,
              COALESCE(SUM(r.commission_earned), 0) AS earned
         FROM referrals r
         JOIN users u ON u.user_id = r.referrer_id
        GROUP BY r.referrer_id
        ORDER BY earned DESC, referrals DESC
        LIMIT ?`,
    )
    .all(limit) as Array<{ username: string | null; referrals: number; earned: number }>;

  return rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    referrals: r.referrals,
    earned: r.earned,
  }));
}
