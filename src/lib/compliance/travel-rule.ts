/**
 * FATF travel rule.
 *
 * A transfer at or above the threshold must carry originator and beneficiary
 * information with it, and the venue must keep the message it sent or received.
 * This module decides whether a transfer is in scope, checks that the required
 * party data is present, and records an auditable message. It does not decide
 * policy for a jurisdiction beyond the configured threshold and the field
 * requirements below, and it never fabricates a party's data — a missing field
 * is a refusal, not a blank.
 *
 * Field requirements follow the FATF Recommendation 16 minimum:
 *  - originator: name, account number, and either an address, a national ID
 *    number, a customer ID number, or date and place of birth. This
 *    implementation requires name, account reference and country, which the
 *    operator maps to the address/ID field of its own filing.
 *  - beneficiary: name and account number. For a withdrawal to a self-hosted
 *    (non-custodial) address the destination address is the account reference,
 *    and the beneficiary name is required only when the operator holds it (a
 *    custodial destination) — `direction` distinguishes the two.
 *
 * The module is free of `next/server` so it can be unit tested.
 */

import { createHash } from 'node:crypto';
import { getDb, generateId } from '@/lib/db';

export class TravelRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 403,
  ) {
    super(message);
  }
}

/** Default threshold, in USD. FATF's illustrative threshold is USD/EUR 1,000. */
export const DEFAULT_THRESHOLD_USD = 1000;

export interface TravelRuleParty {
  /** Legal or registered name of the originator/beneficiary. */
  name?: string | null;
  /** Account number: a user id for an internal account, an address otherwise. */
  accountRef?: string | null;
  /** ISO country code of the party, or of the wallet's hosting. */
  countryCode?: string | null;
}

export interface TravelRuleInput {
  direction: 'withdrawal' | 'transfer';
  /** Transfer amount in USD, or null when it cannot be priced. */
  amountUsd: number | null;
  originator: TravelRuleParty;
  beneficiary: TravelRuleParty;
}

export interface TravelRuleDecision {
  required: boolean;
  thresholdUsd: number;
  originatorComplete: boolean;
  beneficiaryComplete: boolean;
  /** Dotted field names that are missing, for a precise operator message. */
  missing: string[];
}

/** The configured threshold, read from `app_settings` with a safe default. */
export function travelRuleThresholdUsd(): number {
  const row = getDb()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get('travel_rule_threshold_usd') as { value?: string } | undefined;
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_USD;
}

/** Set the threshold. Admin-only; validated by the route that calls it. */
export function setTravelRuleThresholdUsd(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TravelRuleError('VALIDATION_FAILED', 'Threshold must be a positive number', 400);
  }
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run('travel_rule_threshold_usd', String(value));
}

function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Decide whether a transfer is in scope and whether the party data is complete.
 *
 * A transfer that cannot be priced (`amountUsd === null`) is treated as in scope,
 * because the venue must not use "no price" as a way to skip the rule.
 */
export function evaluateTravelRule(input: TravelRuleInput): TravelRuleDecision {
  const thresholdUsd = travelRuleThresholdUsd();
  const required = input.amountUsd === null || input.amountUsd >= thresholdUsd;

  const missing: string[] = [];
  if (!present(input.originator.name)) missing.push('originator.name');
  if (!present(input.originator.accountRef)) missing.push('originator.accountRef');
  if (!present(input.originator.countryCode)) missing.push('originator.countryCode');
  if (!present(input.beneficiary.accountRef)) missing.push('beneficiary.accountRef');
  if (input.direction === 'transfer' && !present(input.beneficiary.name)) missing.push('beneficiary.name');

  return {
    required,
    thresholdUsd,
    originatorComplete: ['originator.name', 'originator.accountRef', 'originator.countryCode'].every((f) => !missing.includes(f)),
    beneficiaryComplete: missing.every((f) => !f.startsWith('beneficiary.')),
    missing,
  };
}

/**
 * Throw when the transfer is in scope and a required field is missing.
 *
 * Returns the decision so the caller can record that the check ran.
 */
export function assertTravelRuleSatisfied(input: TravelRuleInput): TravelRuleDecision {
  const decision = evaluateTravelRule(input);
  if (decision.required && decision.missing.length > 0) {
    throw new TravelRuleError(
      'TRAVEL_RULE_DATA_REQUIRED',
      `This transfer is at or above the ${decision.thresholdUsd} USD travel-rule threshold and is missing: ${decision.missing.join(', ')}`,
      403,
    );
  }
  return decision;
}

/** Build the originator party for a known user from the users table. */
export function originatorFromUser(userId: string): TravelRuleParty {
  const row = getDb()
    .prepare('SELECT display_name, username, user_id, country_code FROM users WHERE user_id = ?')
    .get(userId) as
    | { display_name: string | null; username: string | null; user_id: string; country_code: string | null }
    | undefined;
  if (!row) throw new TravelRuleError('NOT_FOUND', 'Originator account not found', 404);
  return {
    name: row.display_name ?? row.username ?? null,
    accountRef: row.user_id,
    countryCode: row.country_code ?? null,
  };
}

export interface TravelRuleMessageInput {
  direction: 'withdrawal' | 'transfer';
  originator: TravelRuleParty;
  beneficiary: TravelRuleParty;
  amountUsd: number | null;
  asset: string;
  amount: string;
  referenceId: string;
}

/**
 * Record the travel-rule message the venue sent or received.
 *
 * The payload is stored verbatim and a SHA-256 hash of the canonical payload is
 * kept alongside it, so the record is tamper-evident and the operator can prove
 * exactly what was transmitted. The full party names are stored — that is the
 * point of the rule — so the table must be access-controlled (it is read only by
 * an admin route).
 */
export function recordTravelRuleMessage(input: TravelRuleMessageInput): string {
  const payload = JSON.stringify({
    direction: input.direction,
    originator: {
      name: input.originator.name ?? null,
      accountRef: input.originator.accountRef ?? null,
      countryCode: input.originator.countryCode ?? null,
    },
    beneficiary: {
      name: input.beneficiary.name ?? null,
      accountRef: input.beneficiary.accountRef ?? null,
      countryCode: input.beneficiary.countryCode ?? null,
    },
    asset: input.asset,
    amount: input.amount,
    amountUsd: input.amountUsd,
    referenceId: input.referenceId,
    recordedAt: new Date().toISOString(),
  });
  const hash = createHash('sha256').update(payload).digest('hex');
  const messageId = generateId();
  getDb()
    .prepare(
      `INSERT INTO travel_rule_messages
         (message_id, direction, reference_id, asset, amount, amount_usd, payload, payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      messageId,
      input.direction,
      input.referenceId,
      input.asset,
      input.amount,
      input.amountUsd,
      payload,
      hash,
    );
  return messageId;
}

/** The recorded messages, newest first, for the admin console. */
export function listTravelRuleMessages(options: { limit?: number; referenceId?: string } = {}): Array<{
  messageId: string;
  direction: string;
  referenceId: string;
  asset: string;
  amount: string;
  amountUsd: number | null;
  payloadHash: string;
  createdAt: string;
}> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const rows = options.referenceId
    ? (db
        .prepare(
          `SELECT message_id, direction, reference_id, asset, amount, amount_usd, payload_hash, created_at
             FROM travel_rule_messages WHERE reference_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(options.referenceId, limit) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT message_id, direction, reference_id, asset, amount, amount_usd, payload_hash, created_at
             FROM travel_rule_messages ORDER BY created_at DESC LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>);
  return rows.map((row) => ({
    messageId: String(row.message_id),
    direction: String(row.direction),
    referenceId: String(row.reference_id),
    asset: String(row.asset),
    amount: String(row.amount),
    amountUsd: row.amount_usd === null || row.amount_usd === undefined ? null : Number(row.amount_usd),
    payloadHash: String(row.payload_hash),
    createdAt: String(row.created_at),
  }));
}
