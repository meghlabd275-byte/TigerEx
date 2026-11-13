/**
 * Sanctions screening.
 *
 * The exchange screens the addresses and names it is about to transact with
 * against a sanctions list that the operator loads into `sanctions_entries`.
 * Nothing is fetched from a third party at request time and no provider is
 * hardcoded: the list is data, and screening is a lookup over it.
 *
 * Screening fails closed. When enforcement is on and the list has not been
 * loaded, a transaction is refused rather than allowed, because "no match" and
 * "never checked" must not be the same answer. An empty loaded list is a real
 * answer — it means there is nothing to match — and is recorded by the load
 * marker so the two states are distinguishable.
 *
 * The module is free of `next/server` so it can be unit tested.
 */

import { getDb, generateId } from '@/lib/db';

export class SanctionsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 403,
  ) {
    super(message);
  }
}

export interface SanctionsMatch {
  /** The list entry that matched. */
  entryId: string;
  /** The normalised value that matched. */
  value: string;
  /** The list the entry came from, for example `OFAC-SDN`. */
  listName: string;
  reason: string | null;
}

export interface ScreenResult {
  /** True when a listed value matched. */
  matched: boolean;
  /** True when the operator has loaded a list, so a non-match is meaningful. */
  listLoaded: boolean;
  matches: SanctionsMatch[];
}

const LOAD_MARKER = 'sanctions_list_loaded';

/** Normalise an address or name to the canonical comparison form. */
export function normaliseSubject(value: string): string {
  const trimmed = String(value ?? '').trim();
  // An EVM address compares case-insensitively.
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase();
  return trimmed.toLowerCase().replace(/\s+/g, ' ');
}

/** Whether a list has been loaded by the operator. */
export function sanctionsListLoaded(): boolean {
  const row = getDb()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(LOAD_MARKER) as { value?: string } | undefined;
  return row?.value === 'true';
}

/**
 * Whether screening must block on a miss.
 *
 * Enforced in production by default; an operator can force it on or off with
 * `TIGEREX_SANCTIONS_ENFORCE`. Defaulting to enforce in production is what makes
 * an unloaded list a refusal rather than a silent pass.
 */
export function sanctionsEnforced(): boolean {
  const flag = process.env.TIGEREX_SANCTIONS_ENFORCE;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * Screen a single subject (an address or a name) against the loaded list.
 *
 * Returns the matches found and whether a list was loaded, without deciding
 * policy — the caller applies `sanctionsEnforced`.
 */
export function screenSubject(value: string, kind: 'address' | 'name' = 'address'): ScreenResult {
  const subject = normaliseSubject(value);
  if (!subject) throw new SanctionsError('VALIDATION_FAILED', 'A subject to screen is required', 400);

  const rows = getDb()
    .prepare(
      `SELECT entry_id, value, list_name, reason
         FROM sanctions_entries
        WHERE kind = ? AND value = ?`,
    )
    .all(kind, subject) as Array<{ entry_id: string; value: string; list_name: string; reason: string | null }>;

  return {
    matched: rows.length > 0,
    listLoaded: sanctionsListLoaded(),
    matches: rows.map((row) => ({
      entryId: row.entry_id,
      value: row.value,
      listName: row.list_name,
      reason: row.reason ?? null,
    })),
  };
}

/**
 * Apply the screening policy to a subject.
 *
 * Throws `SanctionsError` when the subject is sanctioned or when enforcement is
 * on and the list has not been loaded. A clean pass returns the screen result so
 * the caller can record that the check happened.
 */
export function assertNotSanctioned(value: string, kind: 'address' | 'name' = 'address'): ScreenResult {
  const result = screenSubject(value, kind);

  if (result.matched) {
    throw new SanctionsError('SANCTIONED', 'This counterparty appears on a sanctions list', 403);
  }
  if (sanctionsEnforced() && !result.listLoaded) {
    throw new SanctionsError(
      'SANCTIONS_LIST_NOT_LOADED',
      'Screening is enforced but no sanctions list has been loaded',
      503,
    );
  }
  return result;
}

export interface SanctionsEntryInput {
  value: string;
  kind: 'address' | 'name';
  listName: string;
  reason?: string | null;
}

/** Validate a sanctions-list entry before it is stored. */
export function validateSanctionsEntry(body: Record<string, unknown>): SanctionsEntryInput {
  const value = String(body.value ?? '').trim();
  if (!value) throw new SanctionsError('VALIDATION_FAILED', 'A value is required', 400);

  const kind = String(body.kind ?? 'address').trim().toLowerCase();
  if (kind !== 'address' && kind !== 'name') {
    throw new SanctionsError('VALIDATION_FAILED', "kind must be 'address' or 'name'", 400);
  }
  if (kind === 'address' && !/^0x[0-9a-fA-F]{40}$/.test(value) && !/^[A-Za-z0-9]{20,64}$/.test(value)) {
    throw new SanctionsError('VALIDATION_FAILED', 'A chain address is required', 400);
  }

  const listName = String(body.listName ?? body.list_name ?? '').trim();
  if (!listName) throw new SanctionsError('VALIDATION_FAILED', 'A list name is required', 400);

  return {
    value: normaliseSubject(value),
    kind,
    listName: listName.slice(0, 80),
    reason: body.reason ? String(body.reason).slice(0, 500) : null,
  };
}

/** Add an entry to the list. Idempotent on `(kind, value)`. */
export function addSanctionsEntry(input: SanctionsEntryInput): string {
  const db = getDb();
  const existing = db
    .prepare('SELECT entry_id FROM sanctions_entries WHERE kind = ? AND value = ?')
    .get(input.kind, input.value) as { entry_id: string } | undefined;
  if (existing) return existing.entry_id;

  const entryId = generateId();
  db.prepare(
    `INSERT INTO sanctions_entries (entry_id, kind, value, list_name, reason)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(entryId, input.kind, input.value, input.listName, input.reason);
  return entryId;
}

/** Record that a list has been loaded, so a non-match becomes meaningful. */
export function markSanctionsListLoaded(loaded = true): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(LOAD_MARKER, loaded ? 'true' : 'false');
}
