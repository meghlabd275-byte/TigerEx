/**
 * Balance ledger.
 *
 * Every route that moves user funds debits and credits through here so the
 * checks are identical everywhere: a debit fails closed when the available
 * balance is short, and both sides of a transfer run inside one SQLite
 * transaction. Amounts are validated before any row is touched, so a NaN or a
 * negative amount can never reach the database.
 */

import { getDb, generateId } from '@/lib/db';

export class LedgerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Whether a balance covers an amount.
 *
 * Floating-point amounts are stored as REAL, so a balance that is a hair under
 * an amount it was derived from must not be treated as short. The tolerance is
 * relative to the amount, which keeps it meaningful at both ends of the scale.
 */
export function covers(balance: number, amount: number): boolean {
  const tolerance = Math.max(1e-9, Math.abs(amount) * 1e-9);
  return Number(balance) + tolerance >= Number(amount);
}

/** Total available balance for an asset across a user's wallets. */
export function availableBalance(userId: string, asset: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(b.available), 0) AS available
         FROM balances b
         JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ? AND b.currency = ?`,
    )
    .get(userId, asset) as { available: number } | undefined;
  return Number(row?.available) || 0;
}

/** Total locked balance for an asset across a user's wallets. */
export function lockedBalance(userId: string, asset: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(b.locked), 0) AS locked
         FROM balances b
         JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ? AND b.currency = ?`,
    )
    .get(userId, asset) as { locked: number } | undefined;
  return Number(row?.locked) || 0;
}

/**
 * The user's balance rows for an asset within one wallet type, largest
 * available balance first.
 *
 * A balance is keyed by `(wallet_id, currency)` and a user may hold several
 * wallets of a type, so an asset's funds can sit in more than one row. Every
 * movement below therefore works across the rows rather than trusting a single
 * one, which is what keeps a debit consistent with the total that
 * `availableBalance` reports.
 */
function balanceRows(
  userId: string,
  asset: string,
  walletType: string,
): Array<{ balance_id: string; available: number; locked: number }> {
  return getDb()
    .prepare(
      `SELECT b.balance_id, b.available, b.locked
         FROM balances b
         JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ? AND w.wallet_type = ? AND b.currency = ?
        ORDER BY b.available DESC, b.balance_id`,
    )
    .all(userId, walletType, asset) as Array<{ balance_id: string; available: number; locked: number }>;
}

/**
 * The wallet an asset's first balance row belongs to.
 *
 * An existing row for the asset wins, so a debit reaches the funds the account
 * actually holds. Only when the asset has no row yet is a wallet chosen — the
 * user's lowest-id wallet of the requested type, or a new one.
 */
function walletFor(userId: string, asset: string, walletType: string): string {
  const db = getDb();
  const holder = db
    .prepare(
      `SELECT b.wallet_id
         FROM balances b
         JOIN wallets w ON w.wallet_id = b.wallet_id
        WHERE w.user_id = ? AND w.wallet_type = ? AND b.currency = ?
        ORDER BY b.balance_id
        LIMIT 1`,
    )
    .get(userId, walletType, asset) as { wallet_id: string } | undefined;
  if (holder) return holder.wallet_id;

  const existing = db
    .prepare('SELECT wallet_id FROM wallets WHERE user_id = ? AND wallet_type = ? ORDER BY wallet_id LIMIT 1')
    .get(userId, walletType) as { wallet_id: string } | undefined;
  if (existing) return existing.wallet_id;

  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, status)
     VALUES (?, ?, ?, ?, 'TIGEREX', 'active')`,
  ).run(walletId, userId, walletType, asset);
  return walletId;
}

/** The asset's balance row, created in the user's wallet of this type when absent. */
function balanceRow(userId: string, asset: string, walletType: string): { balance_id: string; available: number; locked: number } {
  const rows = balanceRows(userId, asset, walletType);
  if (rows.length > 0) return rows[0];

  const db = getDb();
  const walletId = walletFor(userId, asset, walletType);
  const balanceId = generateId();
  db.prepare(
    'INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, 0, 0)',
  ).run(balanceId, walletId, asset);
  return { balance_id: balanceId, available: 0, locked: 0 };
}

/** Total available for an asset in one wallet type. */
function availableIn(userId: string, asset: string, walletType: string): number {
  return balanceRows(userId, asset, walletType).reduce((sum, row) => sum + Number(row.available), 0);
}

/** Total locked for an asset in one wallet type. */
function lockedIn(userId: string, asset: string, walletType: string): number {
  return balanceRows(userId, asset, walletType).reduce((sum, row) => sum + Number(row.locked), 0);
}

/**
 * Remove an amount from a user's available balance.
 *
 * Throws `INSUFFICIENT_BALANCE` when the balance cannot cover the amount, so a
 * caller cannot spend funds the account does not hold. The check and every row
 * update run in one transaction to keep concurrent debits honest.
 */
export function debitAvailable(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const rows = balanceRows(userId, asset, walletType);
    if (!covers(availableIn(userId, asset, walletType), amount)) {
      throw new LedgerError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`);
    }
    let left = amount;
    for (const row of rows) {
      if (left <= 1e-12) break;
      const take = Math.min(Number(row.available), left);
      if (take <= 0) continue;
      db.prepare("UPDATE balances SET available = available - ?, updated_at = datetime('now') WHERE balance_id = ?").run(
        take,
        row.balance_id,
      );
      left -= take;
    }
  })();
}

/** Add an amount to a user's available balance, in the asset's own row. */
export function creditAvailable(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const row = balanceRow(userId, asset, walletType);
    db.prepare("UPDATE balances SET available = available + ?, updated_at = datetime('now') WHERE balance_id = ?").run(
      amount,
      row.balance_id,
    );
  })();
}

/**
 * Move an amount from available to locked without changing the total.
 *
 * This is how an order, a P2P escrow or a subscription reserves funds: the
 * asset stays with the user but cannot be spent twice. The reservation is
 * spread across the asset's rows so it can never exceed what the account
 * actually holds.
 */
export function lockAvailable(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const rows = balanceRows(userId, asset, walletType);
    if (!covers(availableIn(userId, asset, walletType), amount)) {
      throw new LedgerError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`);
    }
    let left = amount;
    for (const row of rows) {
      if (left <= 1e-12) break;
      const take = Math.min(Number(row.available), left);
      if (take <= 0) continue;
      db.prepare(
        `UPDATE balances
            SET available = available - ?, locked = locked + ?, updated_at = datetime('now')
          WHERE balance_id = ?`,
      ).run(take, take, row.balance_id);
      left -= take;
    }
  })();
}

/**
 * Move an amount from locked back to available.
 *
 * The release is spread across the rows holding the locked funds, each row
 * returning its own share to available.
 */
export function unlockAvailable(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const rows = balanceRows(userId, asset, walletType);
    if (!covers(lockedIn(userId, asset, walletType), amount)) {
      throw new LedgerError('INSUFFICIENT_LOCKED', `Insufficient locked ${asset} balance`);
    }
    let left = amount;
    for (const row of rows) {
      if (left <= 1e-12) break;
      const take = Math.min(Number(row.locked), left);
      if (take <= 0) continue;
      db.prepare(
        `UPDATE balances
            SET locked = locked - ?, available = available + ?, updated_at = datetime('now')
          WHERE balance_id = ?`,
      ).run(take, take, row.balance_id);
      left -= take;
    }
  })();
}

/** Release locked funds entirely (they leave the user's balance). */
export function consumeLocked(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const rows = balanceRows(userId, asset, walletType);
    if (!covers(lockedIn(userId, asset, walletType), amount)) {
      throw new LedgerError('INSUFFICIENT_LOCKED', `Insufficient locked ${asset} balance`);
    }
    let left = amount;
    for (const row of rows) {
      if (left <= 1e-12) break;
      const take = Math.min(Number(row.locked), left);
      if (take <= 0) continue;
      db.prepare("UPDATE balances SET locked = locked - ?, updated_at = datetime('now') WHERE balance_id = ?").run(
        take,
        row.balance_id,
      );
      left -= take;
    }
  })();
}

/** Record a user-facing transaction row for a balance movement. */
export function recordTransaction(
  userId: string,
  type: string,
  currency: string,
  amount: number,
  fee: number,
  status: string,
  memo: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO transactions (transaction_id, user_id, type, currency, amount, fee, status, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(generateId(), userId, type, currency, amount, fee, status, memo);
}

function assertAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new LedgerError('INVALID_AMOUNT', 'Amount must be a positive number');
  }
}
