import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, finite, positive, upper, NO_STORE } from '@/lib/api/route-guards';

/**
 * Treasury accounts and movements.
 *
 * A treasury account is a hot, warm or cold wallet the exchange controls, keyed
 * by asset and network. A movement records value moving between two accounts or
 * out of the exchange; it does not move on-chain value itself, which the custody
 * service performs. The operator can record an external deposit into treasury
 * and a movement between accounts.
 */

const ACCOUNT_TYPES = ['hot', 'warm', 'cold'];
const ASSETS = ['BTC', 'ETH', 'BNB', 'SOL', 'USDT', 'USDC', 'RUSD', 'TGR'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const accounts = db
    .prepare('SELECT * FROM treasury_accounts ORDER BY asset, network, account_type')
    .all() as Array<Record<string, unknown>>;
  const movements = db
    .prepare('SELECT * FROM treasury_movements ORDER BY created_at DESC LIMIT 500')
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      accounts: accounts.map((row) => ({
        accountId: row.account_id,
        asset: row.asset,
        network: row.network,
        accountType: row.account_type,
        balance: row.balance,
        address: row.address ?? null,
        updatedAt: row.updated_at,
      })),
      movements: movements.map((row) => ({
        movementId: row.movement_id,
        asset: row.asset,
        fromAccount: row.from_account ?? null,
        toAccount: row.to_account ?? null,
        amount: row.amount,
        reason: row.reason,
        txRef: row.tx_ref ?? null,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Register a treasury account. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.treasury.account');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const asset = upper(body.asset);
  if (!ASSETS.includes(asset)) return fail('VALIDATION_FAILED', `asset must be one of ${ASSETS.join(', ')}`);

  const network = upper(body.network);
  if (!/^[A-Z0-9_-]{1,30}$/.test(network)) return fail('VALIDATION_FAILED', 'network is required');

  const accountType = String(body.accountType ?? '').toLowerCase();
  if (!ACCOUNT_TYPES.includes(accountType)) {
    return fail('VALIDATION_FAILED', `accountType must be one of ${ACCOUNT_TYPES.join(', ')}`);
  }

  const address = body.address === undefined || body.address === null ? null : String(body.address).trim().slice(0, 200);

  const db = getDb();
  const existing = db
    .prepare('SELECT account_id FROM treasury_accounts WHERE asset = ? AND network = ? AND account_type = ?')
    .get(asset, network, accountType) as { account_id: string } | undefined;

  if (existing) {
    if (address !== null) {
      db.prepare("UPDATE treasury_accounts SET address = ?, updated_at = datetime('now') WHERE account_id = ?").run(address, existing.account_id);
    }
    recordAdminAction(request, auth.admin, 'treasury.account.update', { type: 'treasury_account', id: existing.account_id, detail: { asset, network, accountType } });
    return NextResponse.json({ success: true, accountId: existing.account_id }, { headers: NO_STORE });
  }

  const accountId = `tre_${asset}_${network}_${accountType}`.toLowerCase();
  db.prepare(
    `INSERT INTO treasury_accounts (account_id, asset, network, account_type, balance, address)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(accountId, asset, network, accountType, address);

  recordAdminAction(request, auth.admin, 'treasury.account.create', { type: 'treasury_account', id: accountId, detail: { asset, network, accountType } });
  return NextResponse.json({ success: true, accountId }, { status: 201, headers: NO_STORE });
}

/**
 * Record a treasury movement.
 *
 * `deposit` adds to an account's balance; `transfer` moves value between two
 * accounts. Both are recorded in the movement log with the reason so the trail
 * reconciles. The balances are kept in one transaction.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.treasury.move');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const kind = String(body.kind ?? '').toLowerCase();
  const amount = positive(body.amount);
  if (amount === null) return fail('VALIDATION_FAILED', 'amount must be a positive number');

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length === 0 || reason.length > 300) {
    return fail('VALIDATION_FAILED', 'reason is required and must be at most 300 characters');
  }

  const txRef = body.txRef === undefined || body.txRef === null ? null : String(body.txRef).slice(0, 200);
  const db = getDb();

  const loadAccount = (id: unknown) => {
    const accountId = String(id ?? '').trim();
    return db.prepare('SELECT account_id, asset, balance FROM treasury_accounts WHERE account_id = ?').get(accountId) as
      | { account_id: string; asset: string; balance: number }
      | undefined;
  };

  if (kind === 'deposit') {
    const account = loadAccount(body.accountId);
    if (!account) return fail('UNKNOWN_ACCOUNT', 'No such treasury account', 404);

    db.transaction(() => {
      db.prepare("UPDATE treasury_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE account_id = ?").run(amount, account.account_id);
      db.prepare(
        `INSERT INTO treasury_movements (movement_id, asset, from_account, to_account, amount, reason, tx_ref)
         VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      ).run(`mov_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, account.asset, account.account_id, amount, reason, txRef);
    })();

    recordAdminAction(request, auth.admin, 'treasury.deposit', { type: 'treasury_account', id: account.account_id, detail: { amount, reason, txRef } });
    return NextResponse.json({ success: true, accountId: account.account_id, amount }, { headers: NO_STORE });
  }

  if (kind === 'transfer') {
    const from = loadAccount(body.fromAccountId);
    const to = loadAccount(body.toAccountId);
    if (!from) return fail('UNKNOWN_ACCOUNT', 'No such source treasury account', 404);
    if (!to) return fail('UNKNOWN_ACCOUNT', 'No such destination treasury account', 404);
    if (from.asset !== to.asset) return fail('ASSET_MISMATCH', 'Source and destination accounts must hold the same asset');
    if (Number(from.balance) < amount) return fail('INSUFFICIENT_TREASURY', 'The source account does not hold enough', 409);

    db.transaction(() => {
      db.prepare("UPDATE treasury_accounts SET balance = balance - ?, updated_at = datetime('now') WHERE account_id = ?").run(amount, from.account_id);
      db.prepare("UPDATE treasury_accounts SET balance = balance + ?, updated_at = datetime('now') WHERE account_id = ?").run(amount, to.account_id);
      db.prepare(
        `INSERT INTO treasury_movements (movement_id, asset, from_account, to_account, amount, reason, tx_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(`mov_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, from.asset, from.account_id, to.account_id, amount, reason, txRef);
    })();

    recordAdminAction(request, auth.admin, 'treasury.transfer', {
      type: 'treasury_movement',
      id: `${from.account_id}->${to.account_id}`,
      detail: { amount, reason },
    });
    return NextResponse.json({ success: true, fromAccountId: from.account_id, toAccountId: to.account_id, amount }, { headers: NO_STORE });
  }

  return fail('VALIDATION_FAILED', 'kind must be deposit or transfer');
}
