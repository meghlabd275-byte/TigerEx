/**
 * Sub-accounts.
 *
 * A sub-account is a named child of a parent account, used by teams and trading
 * firms to keep balances and API keys isolated. Sub-accounts are created and
 * managed by the parent through this module; the administrative console uses
 * the same table with its own authorisation.
 *
 * Free of `next/server` so the rules can be exercised by the logic test runner.
 */

import { getDb, generateId } from '@/lib/db';

export class SubaccountError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** The most sub-accounts one parent may hold. */
export const MAX_SUBACCOUNTS = 300;

export interface SubaccountView {
  subaccountId: string;
  subaccount_id: string;
  parentUserId: string;
  email: string;
  label: string | null;
  permissions: string[];
  status: string;
  createdAt: string;
}

function parsePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toView(row: Record<string, unknown>): SubaccountView {
  return {
    subaccountId: String(row.subaccount_id),
    subaccount_id: String(row.subaccount_id),
    parentUserId: String(row.parent_user_id),
    email: String(row.email),
    label: row.label === null || row.label === undefined ? null : String(row.label),
    permissions: parsePermissions(row.permissions),
    status: String(row.status),
    createdAt: String(row.created_at),
  };
}

/** The parent's own sub-accounts. */
export function listSubaccounts(parentUserId: string): SubaccountView[] {
  const rows = getDb()
    .prepare('SELECT * FROM subaccounts WHERE parent_user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(parentUserId, MAX_SUBACCOUNTS) as Array<Record<string, unknown>>;
  return rows.map(toView);
}

/** Create a sub-account under the caller. */
export function createSubaccount(
  parentUserId: string,
  email: string,
  label?: string,
  permissions: string[] = [],
): SubaccountView {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    throw new SubaccountError('VALIDATION_FAILED', 'A valid email is required');
  }

  const db = getDb();
  if (db.prepare('SELECT 1 FROM subaccounts WHERE parent_user_id = ? AND email = ?').get(parentUserId, normalized)) {
    throw new SubaccountError('DUPLICATE_SUBACCOUNT', 'You already have a sub-account with that email', 409);
  }

  const count = (
    db.prepare('SELECT COUNT(*) AS n FROM subaccounts WHERE parent_user_id = ?').get(parentUserId) as { n: number }
  ).n;
  if (count >= MAX_SUBACCOUNTS) {
    throw new SubaccountError('SUBCACCOUNT_LIMIT', `An account may hold at most ${MAX_SUBACCOUNTS} sub-accounts`, 409);
  }

  const subaccountId = generateId();
  const cleanLabel = label === undefined || label === null ? null : String(label).trim().slice(0, 120) || null;
  db.prepare(
    `INSERT INTO subaccounts (subaccount_id, parent_user_id, email, label, permissions, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  ).run(subaccountId, parentUserId, normalized, cleanLabel, JSON.stringify(permissions.map(String).slice(0, 100)));

  const row = db.prepare('SELECT * FROM subaccounts WHERE subaccount_id = ?').get(subaccountId) as Record<string, unknown>;
  return toView(row);
}

/** Freeze or reactivate one of the parent's sub-accounts. */
export function setSubaccountStatus(parentUserId: string, subaccountId: string, status: string): SubaccountView {
  const id = String(subaccountId ?? '').trim();
  if (!id) throw new SubaccountError('VALIDATION_FAILED', 'subaccountId is required');
  const next = String(status ?? '').trim().toLowerCase();
  if (!['active', 'frozen', 'closed'].includes(next)) {
    throw new SubaccountError('VALIDATION_FAILED', 'status must be active, frozen or closed');
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT status FROM subaccounts WHERE subaccount_id = ? AND parent_user_id = ?')
    .get(id, parentUserId) as { status: string } | undefined;
  if (!existing) throw new SubaccountError('UNKNOWN_SUBACCOUNT', 'No such sub-account for this account', 404);

  db.prepare('UPDATE subaccounts SET status = ? WHERE subaccount_id = ?').run(next, id);
  const row = db.prepare('SELECT * FROM subaccounts WHERE subaccount_id = ?').get(id) as Record<string, unknown>;
  return toView(row);
}
