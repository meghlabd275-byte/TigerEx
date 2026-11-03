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

function walletFor(userId: string, asset: string, walletType: string): string {
  const db = getDb();
  const existing = db
    .prepare('SELECT wallet_id FROM wallets WHERE user_id = ? AND wallet_type = ? LIMIT 1')
    .get(userId, walletType) as { wallet_id: string } | undefined;
  if (existing) return existing.wallet_id;

  const walletId = generateId();
  db.prepare(
    `INSERT INTO wallets (wallet_id, user_id, wallet_type, currency, network, status)
     VALUES (?, ?, ?, ?, 'TIGEREX', 'active')`,
  ).run(walletId, userId, walletType, asset);
  return walletId;
}

function balanceRow(userId: string, asset: string, walletType: string): { balance_id: string; available: number; locked: number } {
  const db = getDb();
  const walletId = walletFor(userId, asset, walletType);
  const existing = db
    .prepare('SELECT balance_id, available, locked FROM balances WHERE wallet_id = ? AND currency = ?')
    .get(walletId, asset) as { balance_id: string; available: number; locked: number } | undefined;
  if (existing) return existing;

  const balanceId = generateId();
  db.prepare(
    'INSERT INTO balances (balance_id, wallet_id, currency, available, locked) VALUES (?, ?, ?, 0, 0)',
  ).run(balanceId, walletId, asset);
  return { balance_id: balanceId, available: 0, locked: 0 };
}

/**
 * Remove an amount from a user's available balance.
 *
 * Throws `INSUFFICIENT_BALANCE` when the balance cannot cover the amount, so a
 * caller cannot spend funds the account does not hold. The check and the update
 * run in one transaction to keep concurrent debits honest.
 */
export function debitAvailable(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const row = balanceRow(userId, asset, walletType);
    if (Number(row.available) + 1e-9 < amount) {
      throw new LedgerError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`);
    }
    db.prepare("UPDATE balances SET available = available - ?, updated_at = datetime('now') WHERE balance_id = ?").run(
      amount,
      row.balance_id,
    );
  })();
}

/** Add an amount to a user's available balance. */
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
 * asset stays with the user but cannot be spent twice.
 */
export function lockAvailable(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const row = balanceRow(userId, asset, walletType);
    if (Number(row.available) + 1e-9 < amount) {
      throw new LedgerError('INSUFFICIENT_BALANCE', `Insufficient ${asset} balance`);
    }
    db.prepare(
      `UPDATE balances
          SET available = available - ?, locked = locked + ?, updated_at = datetime('now')
        WHERE balance_id = ?`,
    ).run(amount, amount, row.balance_id);
  })();
}

/** Move an amount from locked back to available. */
export function unlockAvailable(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const row = balanceRow(userId, asset, walletType);
    if (Number(row.locked) + 1e-9 < amount) {
      throw new LedgerError('INSUFFICIENT_LOCKED', `Insufficient locked ${asset} balance`);
    }
    db.prepare(
      `UPDATE balances
          SET locked = locked - ?, available = available + ?, updated_at = datetime('now')
        WHERE balance_id = ?`,
    ).run(amount, amount, row.balance_id);
  })();
}

/** Release locked funds entirely (they leave the user's balance). */
export function consumeLocked(userId: string, asset: string, amount: number, walletType = 'spot'): void {
  assertAmount(amount);
  const db = getDb();
  db.transaction(() => {
    const row = balanceRow(userId, asset, walletType);
    if (Number(row.locked) + 1e-9 < amount) {
      throw new LedgerError('INSUFFICIENT_LOCKED', `Insufficient locked ${asset} balance`);
    }
    db.prepare("UPDATE balances SET locked = locked - ?, updated_at = datetime('now') WHERE balance_id = ?").run(
      amount,
      row.balance_id,
    );
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
