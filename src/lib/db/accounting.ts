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

/** The venue account a borrowed asset is drawn from and repaid into. */
export function poolAccount(kind: string): string {
  return `pool:${kind}`;
}

/**
 * A margin loan draw: the venue pool lends `asset` to the borrower.
 *
 * Lending credits the borrower an asset the pool holds (matching the engine's
 * `total_supply - total_borrow` cap); repayment burns it back, so the two always
 * cancel and no value is minted.
 */
export function recordMarginBorrow(userId: string, asset: string, amount: number, memo = 'margin borrow'): void {
  if (amount === 0) return;
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount },
    { account: poolAccount('lending'), amount: -amount },
  ]), memo);
}

/** A margin loan repayment: the borrower returns `asset` to the venue pool. */
export function recordMarginRepay(userId: string, asset: string, amount: number, memo = 'margin repay'): void {
  if (amount === 0) return;
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: -amount },
    { account: poolAccount('lending'), amount },
  ]), memo);
}

/** A margin liquidation: the borrower's collateral moves to the liquidator. */
export function recordMarginLiquidation(
  borrowerId: string,
  receiverId: string,
  asset: string,
  amount: number,
  memo = 'margin liquidation',
): void {
  if (amount === 0) return;
  recordEntry(asset, nonZero([
    { account: userAccount(borrowerId), amount: -amount },
    { account: userAccount(receiverId), amount },
  ]), memo);
}

/**
 * An auto-deleveraging close, in its settlement asset.
 *
 * The position's profit would have been paid by the venue pool; ADL pays the
 * trader `profit - clawback` and keeps the rest in the insurance fund, so the
 * pool is relieved of the whole profit: user + (profit - clawback),
 * insurance + clawback, pool - profit.
 */
export function recordAdl(
  userId: string,
  asset: string,
  symbol: string,
  profit: number,
  clawback: number,
  memo = 'auto-deleverage',
): void {
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: profit - clawback },
    { account: insuranceAccount(symbol), amount: clawback },
    { account: futuresPoolAccount(symbol), amount: -profit },
  ]), memo);
}

/**
 * An ETF subscription: the settlement asset moves from the user to the venue's
 * ETF pool, which the minted tokens are backed by.
 */
export function recordEtfSubscribe(userId: string, asset: string, amount: number, memo = 'etf subscribe'): void {
  if (amount === 0) return;
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: -amount },
    { account: poolAccount('etf'), amount },
  ]), memo);
}

/** An ETF redemption: the pool pays the user and the exit fee goes to revenue. */
export function recordEtfRedeem(userId: string, asset: string, proceeds: number, fee: number, memo = 'etf redeem'): void {
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: proceeds },
    { account: FEE_ACCOUNT, amount: fee },
    { account: poolAccount('etf'), amount: -(proceeds + fee) },
  ]), memo);
}

/**
 * A user-to-venue-pool movement where the exact balance delta is already known.
 *
 * Used by engines whose settlement nets several components (an options premium
 * and its fee, a pool payout) into one balance change. `delta` is signed: a
 * positive value credits the user from the pool, a negative value debits them
 * into it. The pool takes the exact opposite leg, so the entry always balances.
 */
export function recordPoolMove(
  userId: string,
  asset: string,
  delta: number,
  poolKind: string,
  memo = 'pool move',
): void {
  if (delta === 0) return;
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: delta },
    { account: poolAccount(poolKind), amount: -delta },
  ]), memo);
}

/**
 * An asset conversion: the fee is taken in the source asset, the net source
 * goes to the venue's conversion pool, and the pool pays out the target asset.
 */
export function recordConvert(
  userId: string,
  fromAsset: string,
  toAsset: string,
  amount: number,
  toAmount: number,
  fee: number,
  memo = 'convert',
): void {
  const pool = poolAccount('convert');
  recordEntry(fromAsset, nonZero([
    { account: userAccount(userId), amount: -amount },
    { account: pool, amount: amount - fee },
    { account: FEE_ACCOUNT, amount: fee },
  ]), memo);
  if (toAmount !== 0) {
    recordEntry(toAsset, nonZero([
      { account: userAccount(userId), amount: toAmount },
      { account: pool, amount: -toAmount },
    ]), memo);
  }
}

/** A user-to-user transfer: two users, one asset, zero-sum. */
export function recordTransfer(senderId: string, receiverId: string, asset: string, amount: number, memo = 'transfer'): void {
  if (amount === 0) return;
  recordBalanced(asset, [
    { account: userAccount(senderId), amount: -amount },
    { account: userAccount(receiverId), amount },
  ], memo);
}

/**
 * A bridge out: the asset (plus the bridge fee) leaves the user for the bridge
 * account, and the fee is booked as revenue in the same asset.
 */
export function recordBridgeOut(userId: string, asset: string, amount: number, fee: number, memo = 'bridge out'): void {
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: -(amount + fee) },
    { account: poolAccount('bridge'), amount },
    { account: FEE_ACCOUNT, amount: fee },
  ]), memo);
}

/** The venue's counterparty account for a derivatives contract. */
export function futuresPoolAccount(symbol: string): string {
  return `futures_pool:${symbol}`;
}

/** A contract's insurance fund, mirroring the `insurance_funds` row. */
export function insuranceAccount(symbol: string): string {
  return `insurance:${symbol}`;
}

/**
 * Record an already-balanced leg set.
 *
 * Derivatives settlement spans more accounts than a spot fill (the venue's
 * counterparty pool, a contract's insurance fund), so the engine builds the
 * legs and this records them. It is the same guard as every other entry: the
 * legs must sum to zero.
 */
export function recordBalanced(asset: string, legs: JournalLeg[], memo = ''): void {
  recordEntry(asset, nonZero(legs), memo);
}

/**
 * A funding movement, in the settlement asset.
 *
 * `amount` is positive when the user receives and negative when the user pays;
 * the venue's counterparty pool takes the other side, so the entry balances.
 */
export function recordFunding(userId: string, asset: string, symbol: string, amount: number, memo = 'funding'): void {
  if (amount === 0) return;
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount },
    { account: futuresPoolAccount(symbol), amount: -amount },
  ]), memo);
}

/** The part of a charged fee set aside into a contract's insurance fund. */
export function recordInsuranceShare(asset: string, symbol: string, amount: number): void {
  if (amount === 0) return;
  recordEntry(asset, nonZero([
    { account: FEE_ACCOUNT, amount: -amount },
    { account: insuranceAccount(symbol), amount },
  ]), `Insurance share ${symbol}`);
}

/** A fee charged in `asset`: the user pays, the venue's fee account receives. */
export function recordFee(userId: string, asset: string, fee: number, memo = 'fee'): void {
  if (fee === 0) return;
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: -fee },
    { account: FEE_ACCOUNT, amount: fee },
  ]), memo);
}

/**
 * A derivatives close, in its settlement asset.
 *
 * The margin release is net-zero (locked to available) and is not journaled.
 * The realised PnL is settled against the venue's counterparty pool and the fee
 * accrues to the venue: user + (pnl - fee), pool - pnl, fees + fee.
 */
export function recordFuturesClose(
  userId: string,
  asset: string,
  symbol: string,
  grossPnl: number,
  fee: number,
  memo = 'futures close',
): void {
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: grossPnl - fee },
    { account: futuresPoolAccount(symbol), amount: -grossPnl },
    { account: FEE_ACCOUNT, amount: fee },
  ]), memo);
}

/**
 * A liquidation, in its settlement asset.
 *
 * The margin is consumed, the position's loss is the venue pool's gain, and the
 * insurance fund covers whatever the margin could not. The three legs sum to
 * zero by construction: -margin - pnl + (pnl + margin) = 0.
 */
export function recordFuturesLiquidation(
  userId: string,
  asset: string,
  symbol: string,
  margin: number,
  grossPnl: number,
  memo = 'futures liquidation',
): void {
  recordEntry(asset, nonZero([
    { account: userAccount(userId), amount: -margin },
    { account: futuresPoolAccount(symbol), amount: -grossPnl },
    { account: insuranceAccount(symbol), amount: grossPnl + margin },
  ]), memo);
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
