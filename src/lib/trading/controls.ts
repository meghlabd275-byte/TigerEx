/**
 * Exchange control checks shared by the venue engines.
 *
 * The admin console writes circuit-breaker state to `exchange_controls`; this
 * is the read side every execution path must go through so that pausing a venue
 * actually stops it. A pause on `exchange` implies every venue, so a single
 * emergency stop halts the whole book.
 */

import { getDb } from '@/lib/db';

export interface PausedScope {
  scope: string;
  reason: string | null;
}

/**
 * The first paused scope among the requested venues, or null when all are open.
 *
 * `exchange` is always checked, so an exchange-wide pause blocks every caller
 * regardless of which venue it asked about.
 */
export function pausedScope(...scopes: string[]): PausedScope | null {
  const all = Array.from(new Set(['exchange', ...scopes]));
  const placeholders = all.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT scope, paused, reason FROM exchange_controls WHERE scope IN (${placeholders})`)
    .all(...all) as Array<{ scope: string; paused: number; reason: string | null }>;
  const paused = rows.find((row) => row.paused === 1);
  return paused ? { scope: paused.scope, reason: paused.reason } : null;
}

/** Human-readable reason for a paused scope, suitable for an error message. */
export function pauseMessage(paused: PausedScope): string {
  return `${paused.scope} is paused${paused.reason ? `: ${paused.reason}` : ''}`;
}
