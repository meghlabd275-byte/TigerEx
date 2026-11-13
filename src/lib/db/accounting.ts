/**
 * Journal-backed accounting for value that enters or leaves the venue.
 *
 * A deposit and a withdrawal are the only events that change the venue's total
 * liabilities: an internal trade or transfer moves value between accounts and
 * nets to zero. This module records those external events in the double-entry
 * journal, next to the balance move, so the journal is the authoritative record
 * of what the venue owes and why.
 *
 * Every function here is meant to be called inside the same SQLite transaction
 * as the balance change it describes; the journal and the materialised balance
 * then move together or not at all.
 */

import { getDb } from '@/lib/db';
import { recordEntry, verifyChain, userAccount, EXTERNAL_ACCOUNT, FEE_ACCOUNT, type JournalLeg, type ChainCheck } from '@/lib/db/journal';

/** A deposit was credited to the user: value enters from outside. */
export function recordDeposit(userId: string, asset: string, amount: number, memo = 'deposit'): void {
  recordEntry(asset, [
    { account: EXTERNAL_ACCOUNT, amount: -amount },
    { account: userAccount(userId), amount },
  ], memo);
}

/** A credited deposit was reversed (reorg): value leaves again. */
export function reverseDeposit(userId: string, asset: string, amount: number, memo = 'deposit reorg reversal'): void {
  recordEntry(asset, [
    { account: EXTERNAL_ACCOUNT, amount },
    { account: userAccount(userId), amount: -amount },
  ], memo);
}

/** A withdrawal left the venue: the user's reservation is consumed. */
export function recordWithdrawal(userId: string, asset: string, amount: number, memo = 'withdrawal'): void {
  recordEntry(asset, [
    { account: userAccount(userId), amount: -amount },
    { account: EXTERNAL_ACCOUNT, amount },
  ], memo);
}

/** A broadcast withdrawal reverted: the reservation returns to the user. */
export function reverseWithdrawal(userId: string, asset: string, amount: number, memo = 'withdrawal reverted'): void {
  recordEntry(asset, [
    { account: userAccount(userId), amount },
    { account: EXTERNAL_ACCOUNT, amount: -amount },
  ], memo);
}

export interface TradeSettlement {
  base: string;
  quote: string;
  buyerId: string;
  sellerId: string;
  /** Base quantity traded. */
  quantity: number;
  /** price * quantity, the quote the buyer pays. */
  grossQuote: number;
  /** The buyer's fee, charged in base. */
  buyerFeeBase: number;
  /** The seller's fee, charged in quote. */
  sellerFeeQuote: number;
}

/** Drop zero legs: the journal refuses a zero-amount leg by design. */
function nonZero(legs: JournalLeg[]): JournalLeg[] {
  return legs.filter((leg) => leg.amount !== 0);
}

/**
 * A spot fill, as two balanced entries — one per asset.
 *
 * A trade moves no value into or out of the venue, so both entries net to zero:
 * the buyer receives base net of its fee, the seller delivers the base, and the
 * fee accrues to the venue. The same shape holds for the quote side.
 */
export function recordTrade(s: TradeSettlement, memo = 'spot trade'): void {
  recordEntry(s.base, nonZero([
    { account: userAccount(s.buyerId), amount: s.quantity - s.buyerFeeBase },
    { account: userAccount(s.sellerId), amount: -s.quantity },
    { account: FEE_ACCOUNT, amount: s.buyerFeeBase },
  ]), `${memo} (base)`);

  recordEntry(s.quote, nonZero([
    { account: userAccount(s.buyerId), amount: -s.grossQuote },
    { account: userAccount(s.sellerId), amount: s.grossQuote - s.sellerFeeQuote },
    { account: FEE_ACCOUNT, amount: s.sellerFeeQuote },
  ]), `${memo} (quote)`);
}

export interface JournalReconciliationEntry {
  asset: string;
  /** Net user holding per the journal. */
  journalUser: number;
  /** Net user holding per the materialised balances. */
  ledgerUser: number;
  difference: number;
  ok: boolean;
}

export interface JournalReconciliation {
  generatedAt: string;
  ok: boolean;
  chain: ChainCheck;
  entries: JournalReconciliationEntry[];
}

/**
 * Reconcile the journal against the materialised balances.
 *
 * An internal transfer is zero-sum at the aggregate level, so the sum of every
 * user account in the journal must equal the sum of every user balance in the
 * ledger, per asset. A difference means a balance moved without a journal
 * entry (or the reverse) — exactly the drift a reconciliation job exists to
 * catch. It never adjusts anything; it reports.
 */
export function reconcileJournal(): JournalReconciliation {
  const db = getDb();

  const journalRows = db
    .prepare(
      `SELECT e.asset AS asset, COALESCE(SUM(l.amount), 0) AS total
         FROM journal_legs l
         JOIN journal_entries e ON e.entry_id = l.entry_id
        WHERE l.account LIKE 'user:%'
        GROUP BY e.asset`,
    )
    .all() as Array<{ asset: string; total: number }>;

  const ledgerRows = db
    .prepare(
      `SELECT currency AS asset, COALESCE(SUM(available + locked), 0) AS total
         FROM balances
        GROUP BY currency`,
    )
    .all() as Array<{ asset: string; total: number }>;

  const journal = new Map(journalRows.map((r) => [r.asset, Number(r.total)]));
  const ledger = new Map(ledgerRows.map((r) => [r.asset, Number(r.total)]));
  const assets = [...new Set([...journal.keys(), ...ledger.keys()])].sort();

  const entries = assets.map((asset) => {
    const journalUser = journal.get(asset) ?? 0;
    const ledgerUser = ledger.get(asset) ?? 0;
    const difference = journalUser - ledgerUser;
    const tolerance = Math.max(1e-6, Math.abs(ledgerUser) * 1e-9);
    return { asset, journalUser, ledgerUser, difference, ok: Math.abs(difference) <= tolerance };
  });

  const chain = verifyChain();
  return {
    generatedAt: new Date().toISOString(),
    ok: chain.ok && entries.every((e) => e.ok),
    chain,
    entries,
  };
}
