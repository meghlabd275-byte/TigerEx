/**
 * Market listing bootstrap.
 *
 * A fresh venue has no trading pairs, so nothing can be quoted or traded until
 * an operator lists some. Rather than invent pairs, this module reads the pairs
 * the operator declares in `TIGEREX_MARKETS` (a JSON array of listing objects),
 * validates each with the same rules the admin console uses, and inserts the
 * ones that are not already present.
 *
 * It is idempotent and additive: an existing symbol is left untouched, so
 * re-running never overwrites an operator's later edits. Nothing is seeded when
 * the variable is unset — a venue with no declared markets stays empty and the
 * readiness probe reports it.
 *
 * The module is free of `next/server` so it can be unit tested.
 */

import { getDb, generateId } from '@/lib/db';
import { validatePairInput, PairInput } from '@/lib/markets/listing';

export interface SeedReport {
  /** True when no market list was configured, so nothing was considered. */
  configured: boolean;
  created: string[];
  skipped: string[];
  invalid: Array<{ symbol: string; error: string }>;
}

/** Parse the configured market list. Returns null when it is not configured. */
export function configuredPairs(raw = process.env.TIGEREX_MARKETS): unknown[] | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('TIGEREX_MARKETS is not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('TIGEREX_MARKETS must be a JSON array');
  return parsed;
}

function pairExists(symbol: string): boolean {
  const row = getDb().prepare('SELECT pair_id FROM trading_pairs WHERE symbol = ?').get(symbol) as
    | { pair_id: string }
    | undefined;
  return Boolean(row);
}

function insertPair(pair: PairInput): void {
  getDb()
    .prepare(
      `INSERT INTO trading_pairs
         (pair_id, base_currency, quote_currency, symbol, status,
          min_price, max_price, tick_size, min_quantity, max_quantity, min_notional, maker_fee, taker_fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      generateId(),
      pair.baseCurrency,
      pair.quoteCurrency,
      pair.symbol,
      pair.status,
      pair.minPrice,
      pair.maxPrice,
      pair.tickSize,
      pair.minQuantity,
      pair.maxQuantity,
      pair.minNotional,
      pair.makerFee,
      pair.takerFee,
    );
}

/**
 * Seed the configured markets.
 *
 * Each entry is validated independently; an invalid entry is reported rather
 * than aborting the whole list, so one typo does not stop the valid markets from
 * being listed.
 */
export function seedMarkets(raw = process.env.TIGEREX_MARKETS): SeedReport {
  const report: SeedReport = { configured: false, created: [], skipped: [], invalid: [] };

  const pairs = configuredPairs(raw);
  if (pairs === null) return report;
  report.configured = true;

  for (const entry of pairs) {
    const body = (entry ?? {}) as Record<string, unknown>;
    const symbol = String(body.symbol ?? '').trim().toUpperCase();

    const validated = validatePairInput(body);
    if ('error' in validated) {
      report.invalid.push({ symbol: symbol || '(missing symbol)', error: validated.error });
      continue;
    }

    if (pairExists(validated.pair.symbol)) {
      report.skipped.push(validated.pair.symbol);
      continue;
    }

    insertPair(validated.pair);
    report.created.push(validated.pair.symbol);
  }

  return report;
}
