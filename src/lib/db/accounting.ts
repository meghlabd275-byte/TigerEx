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

import { recordEntry, userAccount, EXTERNAL_ACCOUNT } from '@/lib/db/journal';

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
