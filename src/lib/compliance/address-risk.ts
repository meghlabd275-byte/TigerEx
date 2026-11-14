/**
 * Destination address risk scoring.
 *
 * A withdrawal destination is scored from the venue's own data — never from a
 * third-party risk API. The signals are real and local:
 *
 *  - a sanctions match (reuses the loaded sanctions list) is an outright block;
 *  - an operator blocklist entry is a block, and an operator review entry adds
 *    the score the operator recorded;
 *  - an address the user has already withdrawn to, or has saved in their own
 *    address book, is lower risk than one never seen before;
 *  - a first-seen address above a configured value threshold scores higher,
 *    because a large withdrawal to a brand-new destination is the classic
 *    account-takeover pattern.
 *
 * The module is free of `next/server` so it can be unit tested. Every query is
 * parameterised and nothing is fabricated: an address with no history is scored
 * as first-seen, not given a default reputation.
 */

import { getDb, generateId } from '@/lib/db';
import { normaliseSubject, screenSubject } from '@/lib/compliance/sanctions';

export type RiskBand = 'low' | 'medium' | 'high' | 'blocked';

export interface AddressAssessment {
  address: string;
  network: string;
  score: number;
  band: RiskBand;
  firstSeen: boolean;
  /** Human-readable reasons, so an operator can see why the score is what it is. */
  reasons: string[];
  /** True when the venue should refuse the transfer outright. */
  blocked: boolean;
  /** True when the transfer should be held for manual review. */
  requiresReview: boolean;
}

/** Value (USD) above which a first-seen destination is treated as higher risk. */
export const HIGH_VALUE_USD = 10000;
/** Score at or above which a transfer is held for review. */
export const REVIEW_BAND_SCORE = 60;
/** Score at or above which a transfer is refused outright. */
export const BLOCK_BAND_SCORE = 90;

function bandFor(score: number, blocked: boolean): RiskBand {
  if (blocked || score >= BLOCK_BAND_SCORE) return 'blocked';
  if (score >= REVIEW_BAND_SCORE) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/** Operator-recorded risk entry for an address, if any. */
function operatorEntry(address: string, network: string): { band: RiskBand; reason: string | null } | null {
  const row = getDb()
    .prepare('SELECT band, reason FROM address_risk_entries WHERE address = ? AND network = ?')
    .get(address, network) as { band: RiskBand; reason: string | null } | undefined;
  return row ?? null;
}

/** Whether this user has withdrawn to the address before (a trusted destination). */
function seenByUser(userId: string, address: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS hit FROM address_risk_history WHERE user_id = ? AND address = ? LIMIT 1')
    .get(userId, address) as { hit: number } | undefined;
  return Boolean(row);
}

/** Whether the address is in the user's saved address book. */
function inAddressBook(userId: string, address: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS hit FROM withdrawal_whitelist WHERE user_id = ? AND address = ? LIMIT 1')
    .get(userId, address) as { hit: number } | undefined;
  return Boolean(row);
}

function firstSeenGlobally(address: string, network: string): boolean {
  const row = getDb()
    .prepare('SELECT first_seen FROM screened_addresses WHERE address = ? AND network = ?')
    .get(address, network) as { first_seen: string } | undefined;
  return !row;
}

function recordScreened(address: string, network: string, band: RiskBand): void {
  getDb()
    .prepare(
      `INSERT INTO screened_addresses (address, network, first_seen, last_seen, times_screened, last_band)
       VALUES (?, ?, datetime('now'), datetime('now'), 1, ?)
       ON CONFLICT(address, network) DO UPDATE SET
         last_seen = datetime('now'),
         times_screened = times_screened + 1,
         last_band = excluded.last_band`,
    )
    .run(address, network, band);
}

function recordHistory(userId: string, address: string, network: string, band: RiskBand): void {
  getDb()
    .prepare(
      `INSERT INTO address_risk_history (id, user_id, address, network, last_band, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id, address) DO UPDATE SET last_seen = datetime('now'), last_band = excluded.last_band`,
    )
    .run(generateId(), userId, address, network, band);
}

export interface AssessInput {
  userId: string;
  address: string;
  network: string;
  amountUsd: number | null;
}

/**
 * Score a destination address. This is read-only with respect to the decision;
 * call `recordAddressOutcome` once the transfer is actually accepted so the
 * history reflects real use rather than attempts.
 */
export function assessAddress(input: AssessInput): AddressAssessment {
  const address = normaliseSubject(input.address);
  const network = String(input.network ?? '').trim().toUpperCase();
  if (!address || !network) {
    return {
      address,
      network,
      score: 100,
      band: 'blocked',
      firstSeen: true,
      reasons: ['address or network missing'],
      blocked: true,
      requiresReview: false,
    };
  }

  const reasons: string[] = [];
  let score = 0;
  let blocked = false;

  // Sanctions is authoritative: a match is a hard block.
  const sanctions = screenSubject(address, 'address');
  if (sanctions.matched) {
    blocked = true;
    score = 100;
    reasons.push(`sanctions match: ${sanctions.matches.map((m) => m.listName).join(', ')}`);
  }

  const entry = operatorEntry(address, network);
  if (entry) {
    if (entry.band === 'blocked') {
      blocked = true;
      score = Math.max(score, 100);
    } else {
      score += entry.band === 'high' ? 60 : entry.band === 'medium' ? 30 : 0;
    }
    reasons.push(`operator entry: ${entry.band}${entry.reason ? ` (${entry.reason})` : ''}`);
  }

  const firstSeen = firstSeenGlobally(address, network);
  if (firstSeen) {
    score += 15;
    reasons.push('first time this address has been seen on this network');
  }

  const known = seenByUser(input.userId, address) || inAddressBook(input.userId, address);
  if (known) {
    // A destination the user has used or saved is the trusted case.
    score = Math.max(0, score - 25);
    reasons.push('destination is in the account address book or has been used before');
  } else if (input.amountUsd !== null && input.amountUsd >= HIGH_VALUE_USD) {
    // First-seen (15) plus a high value (50) crosses the review band, so a large
    // withdrawal to a brand-new destination is always held.
    score += 50;
    reasons.push(`first-time destination above the ${HIGH_VALUE_USD} USD review threshold`);
  }

  score = Math.min(100, Math.max(0, score));
  const band = bandFor(score, blocked);
  return {
    address,
    network,
    score,
    band,
    firstSeen,
    reasons,
    blocked: blocked || band === 'blocked',
    requiresReview: !blocked && score >= REVIEW_BAND_SCORE,
  };
}

/** Record that an accepted transfer used this destination, so it is trusted next time. */
export function recordAddressOutcome(input: AssessInput): void {
  const address = normaliseSubject(input.address);
  const network = String(input.network ?? '').trim().toUpperCase();
  if (!address || !network) return;
  const assessment = assessAddress(input);
  recordScreened(address, network, assessment.band);
  recordHistory(input.userId, address, network, assessment.band);
}

/** Operator management of the address risk list. */
export function setAddressRisk(
  address: string,
  network: string,
  band: RiskBand,
  reason: string | null,
): void {
  const normalised = normaliseSubject(address);
  const net = String(network ?? '').trim().toUpperCase();
  if (!normalised || !net) throw new Error('address and network are required');
  if (!['low', 'medium', 'high', 'blocked'].includes(band)) throw new Error('invalid band');
  getDb()
    .prepare(
      `INSERT INTO address_risk_entries (address, network, band, reason, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(address, network) DO UPDATE SET band = excluded.band, reason = excluded.reason, updated_at = datetime('now')`,
    )
    .run(normalised, net, band, reason);
}

export function removeAddressRisk(address: string, network: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM address_risk_entries WHERE address = ? AND network = ?')
    .run(normaliseSubject(address), String(network ?? '').trim().toUpperCase());
  return result.changes > 0;
}

export function listAddressRisk(limit = 200): Array<{ address: string; network: string; band: RiskBand; reason: string | null }> {
  const rows = getDb()
    .prepare('SELECT address, network, band, reason FROM address_risk_entries ORDER BY updated_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 1000)) as Array<{ address: string; network: string; band: RiskBand; reason: string | null }>;
  return rows;
}
