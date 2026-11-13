/**
 * Double-entry journal.
 *
 * The `balances` table is a materialised view of where funds sit right now.
 * This is the authoritative, append-only record of how they got there: every
 * movement is one entry whose legs sum to exactly zero for its asset, so the
 * books balance by construction and an unbalanced entry cannot be written.
 *
 * Each entry is hash-chained to the one before it (SHA-256 over its own fields
 * plus the previous hash). An entry that is edited, or removed from anywhere
 * but the tail, breaks the chain from that point on, which `verifyChain`
 * detects. Removing the newest entry is a valid prefix, so the head hash must
 * be anchored outside the database (proof-of-reserves, an on-chain anchor) to
 * catch a truncated tail.
 */

import { createHash } from 'crypto';
import { getDb, generateId } from '@/lib/db';

export class JournalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export interface JournalLeg {
  /** An account string: `user:<id>`, `treasury`, `fees`, `external`, ... */
  account: string;
  /** Signed amount: positive is a debit, negative is a credit. */
  amount: number;
}

/** A user's holding of an asset, per wallet type (spot, futures, ...). */
export function userAccount(userId: string, walletType = 'spot'): string {
  return `user:${userId}:${walletType}`;
}

export const TREASURY_ACCOUNT = 'treasury';
export const FEE_ACCOUNT = 'fees';
/** The counterparty for funds entering or leaving the venue (deposits, withdrawals). */
export const EXTERNAL_ACCOUNT = 'external';

const SCALE = 1e9;

function round(value: number): number {
  return Math.round(value * SCALE) / SCALE;
}

function assertLegs(legs: JournalLeg[]): { asset: string } {
  if (!Array.isArray(legs) || legs.length < 2) {
    throw new JournalError('UNBALANCED_ENTRY', 'A journal entry needs at least two legs');
  }
  for (const leg of legs) {
    if (typeof leg.account !== 'string' || !leg.account.trim()) {
      throw new JournalError('INVALID_ACCOUNT', 'Every journal leg needs a non-empty account');
    }
    if (!Number.isFinite(leg.amount) || leg.amount === 0) {
      throw new JournalError('INVALID_AMOUNT', 'Every journal leg needs a non-zero finite amount');
    }
  }
  const sum = legs.reduce((total, leg) => total + leg.amount, 0);
  if (Math.abs(round(sum)) > 1e-9) {
    throw new JournalError('UNBALANCED_ENTRY', `Journal legs must sum to zero (got ${sum})`);
  }
  return { asset: '' };
}

/**
 * The canonical bytes an entry's hash is taken over.
 *
 * Legs are sorted so two equal entries hash identically regardless of the order
 * the caller listed them in; amounts are fixed to nine decimals so 1 and 1.0
 * hash the same.
 */
function canonical(prevHash: string | null, asset: string, memo: string, createdAt: string, legs: JournalLeg[]): string {
  const sorted = [...legs]
    .map((leg) => `${leg.account}:${leg.amount.toFixed(9)}`)
    .sort()
    .join('|');
  return `${prevHash ?? ''}\n${asset}\n${memo}\n${createdAt}\n${sorted}`;
}

export function hashEntry(prevHash: string | null, asset: string, memo: string, createdAt: string, legs: JournalLeg[]): string {
  return createHash('sha256').update(canonical(prevHash, asset, memo, createdAt, legs)).digest('hex');
}

/**
 * Append one balanced entry.
 *
 * Wrap the balance move and this call in the same SQLite transaction: the
 * journal and the materialised balance must move together or not at all.
 */
export function recordEntry(asset: string, legs: JournalLeg[], memo = ''): { entryId: string; hash: string; sequence: number } {
  if (typeof asset !== 'string' || !asset.trim()) {
    throw new JournalError('INVALID_ASSET', 'A journal entry needs an asset');
  }
  assertLegs(legs);

  const db = getDb();
  const run = db.transaction(() => {
    const head = db
      .prepare('SELECT sequence, hash FROM journal_entries ORDER BY sequence DESC LIMIT 1')
      .get() as { sequence: number; hash: string } | undefined;
    const sequence = (head?.sequence ?? 0) + 1;
    const prevHash = head?.hash ?? null;
    const createdAt = new Date().toISOString();
    const hash = hashEntry(prevHash, asset, memo, createdAt, legs);
    const entryId = generateId();

    db.prepare(
      `INSERT INTO journal_entries (entry_id, sequence, asset, memo, created_at, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(entryId, sequence, asset, memo, createdAt, prevHash, hash);

    const insertLeg = db.prepare('INSERT INTO journal_legs (leg_id, entry_id, account, amount) VALUES (?, ?, ?, ?)');
    for (const leg of legs) insertLeg.run(generateId(), entryId, leg.account, round(leg.amount));

    return { entryId, hash, sequence };
  });
  return run();
}

/** The net signed balance of an account, summed across every entry. */
export function accountBalance(account: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM journal_legs WHERE account = ?')
    .get(account) as { balance: number } | undefined;
  return round(Number(row?.balance) || 0);
}

export interface ChainCheck {
  ok: boolean;
  entries: number;
  /** The first sequence whose stored hash does not match its recomputed hash. */
  brokenAt?: number;
  reason?: string;
}

/**
 * Recompute every entry's hash and confirm the chain is intact.
 *
 * Returns the sequence of the first broken link rather than throwing, so a
 * reconciliation job can report the damage instead of crashing on it.
 */
export function verifyChain(): ChainCheck {
  const db = getDb();
  const entries = db
    .prepare('SELECT entry_id, sequence, asset, memo, created_at, prev_hash, hash FROM journal_entries ORDER BY sequence ASC')
    .all() as Array<{
    entry_id: string;
    sequence: number;
    asset: string;
    memo: string | null;
    created_at: string;
    prev_hash: string | null;
    hash: string;
  }>;

  let prevHash: string | null = null;
  let expectedSequence = 1;
  for (const entry of entries) {
    if (entry.sequence !== expectedSequence) {
      return { ok: false, entries: entries.length, brokenAt: entry.sequence, reason: 'SEQUENCE_GAP' };
    }
    if ((entry.prev_hash ?? null) !== prevHash) {
      return { ok: false, entries: entries.length, brokenAt: entry.sequence, reason: 'PREV_HASH_MISMATCH' };
    }
    const legs = db
      .prepare('SELECT account, amount FROM journal_legs WHERE entry_id = ?')
      .all(entry.entry_id) as JournalLeg[];
    const recomputed = hashEntry(prevHash, entry.asset, entry.memo ?? '', entry.created_at, legs);
    if (recomputed !== entry.hash) {
      return { ok: false, entries: entries.length, brokenAt: entry.sequence, reason: 'HASH_MISMATCH' };
    }
    prevHash = entry.hash;
    expectedSequence += 1;
  }
  return { ok: true, entries: entries.length };
}

/** The legs of one entry, for a statement or an audit view. */
export function entryLegs(entryId: string): JournalLeg[] {
  return getDb().prepare('SELECT account, amount FROM journal_legs WHERE entry_id = ?').all(entryId) as JournalLeg[];
}
