/**
 * P2P user profile and settings.
 *
 * A merchant's public profile is computed from their own settled P2P orders, so
 * the completion rate and order count are real. Settings (auto-reply, payment
 * window, blocked counterparties) are stored in the account's `user_settings`
 * preferences blob under a `p2p` key, which is the same row the settings view
 * reads.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb } from '@/lib/db';

export class P2pProfileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface P2pProfile {
  userId: string;
  displayName: string;
  completedOrders: number;
  totalOrders: number;
  completionRate: number;
  activeAds: number;
  memberSince: string | null;
}

/** A merchant's public profile, computed from their settled P2P orders. */
export function merchantProfile(userId: string): P2pProfile {
  const db = getDb();
  const user = db
    .prepare('SELECT user_id, username, display_name, created_at FROM users WHERE user_id = ?')
    .get(userId) as
    | { user_id: string; username: string | null; display_name: string | null; created_at: string | null }
    | undefined;
  if (!user) throw new P2pProfileError('NOT_FOUND', 'No such account', 404);

  const orders = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IN ('completed', 'released') THEN 1 ELSE 0 END) AS completed
       FROM p2p_orders
      WHERE buyer_id = ? OR seller_id = ?`,
    )
    .get(userId, userId) as { total: number; completed: number } | undefined;
  const totalOrders = Number(orders?.total) || 0;
  const completedOrders = Number(orders?.completed) || 0;

  const ads = db
    .prepare("SELECT COUNT(*) AS n FROM p2p_offers WHERE user_id = ? AND status = 'active'")
    .get(userId) as { n: number } | undefined;

  const displayName = String(user.display_name || user.username || `trader-${userId.slice(0, 8)}`);
  return {
    userId,
    displayName,
    completedOrders,
    totalOrders,
    completionRate: totalOrders === 0 ? 0 : completedOrders / totalOrders,
    activeAds: Number(ads?.n) || 0,
    memberSince: user.created_at,
  };
}

export interface P2pSettings {
  autoReply: string | null;
  paymentWindowMinutes: number;
  blockedCounterparties: string[];
}

const DEFAULTS: P2pSettings = { autoReply: null, paymentWindowMinutes: 15, blockedCounterparties: [] };

function readPreferences(userId: string): Record<string, unknown> {
  const row = getDb()
    .prepare('SELECT preferences FROM user_settings WHERE user_id = ?')
    .get(userId) as { preferences: string } | undefined;
  if (!row?.preferences) return {};
  try {
    const parsed = JSON.parse(row.preferences);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writePreferences(userId: string, preferences: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO user_settings (user_id, preferences, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences, updated_at = datetime('now')`,
    )
    .run(userId, JSON.stringify(preferences));
}

/** The caller's P2P settings, with defaults filled in. */
export function p2pSettings(userId: string): P2pSettings {
  const preferences = readPreferences(userId);
  const stored = preferences.p2p;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULTS };
  const value = stored as Record<string, unknown>;
  const window = Number(value.paymentWindowMinutes);
  return {
    autoReply: value.autoReply === null || value.autoReply === undefined ? null : String(value.autoReply).slice(0, 200),
    paymentWindowMinutes: Number.isFinite(window) && window > 0 ? Math.trunc(window) : DEFAULTS.paymentWindowMinutes,
    blockedCounterparties: Array.isArray(value.blockedCounterparties)
      ? value.blockedCounterparties.map((id) => String(id)).slice(0, 500)
      : [],
  };
}

/** Update the caller's P2P settings. */
export function updateP2pSettings(userId: string, changes: Record<string, unknown>): P2pSettings {
  const current = p2pSettings(userId);
  const next: P2pSettings = { ...current };

  if (changes.autoReply !== undefined) {
    if (changes.autoReply === null) next.autoReply = null;
    else {
      const text = String(changes.autoReply);
      if (text.length > 200) throw new P2pProfileError('VALIDATION_FAILED', 'The auto-reply is too long');
      next.autoReply = text.length > 0 ? text : null;
    }
  }

  if (changes.paymentWindowMinutes !== undefined) {
    const minutes = Number(changes.paymentWindowMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      throw new P2pProfileError('VALIDATION_FAILED', 'paymentWindowMinutes must be an integer in [1, 1440]');
    }
    next.paymentWindowMinutes = minutes;
  }

  if (changes.blockedCounterparties !== undefined) {
    if (!Array.isArray(changes.blockedCounterparties)) {
      throw new P2pProfileError('VALIDATION_FAILED', 'blockedCounterparties must be an array');
    }
    next.blockedCounterparties = changes.blockedCounterparties.map((id) => String(id)).slice(0, 500);
  }

  const preferences = readPreferences(userId);
  writePreferences(userId, { ...preferences, p2p: next });
  return next;
}

/** Whether the caller has blocked a counterparty. */
export function isBlocked(userId: string, counterpartyId: string): boolean {
  return p2pSettings(userId).blockedCounterparties.includes(counterpartyId);
}
