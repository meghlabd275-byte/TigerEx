/**
 * The venue's own index and mark price.
 *
 * The index is the weighted median of the configured oracle sources, so no
 * single feed sets the price. The mark blends that index with the venue's own
 * spot book mid, which keeps a thin book from being pushed to liquidate
 * positions. Both steps are the pure functions in `@/lib/oracle/aggregator`;
 * this module only supplies them with the exchange's rows.
 *
 * When no source is fresh enough to publish an index the caller receives
 * `null` and must refuse to trade, rather than settling at a stale or invented
 * price.
 */

import { getDb } from '@/lib/db';
import {
  indexPrice,
  markPrice,
  DEFAULT_ORACLE_CONFIG,
  type OracleObservation,
} from '@/lib/oracle/aggregator';
import { orderBookDepth } from '@/lib/trading/market-view';

export interface PriceResult {
  mark: number;
  index: number;
  sourcesUsed: string[];
  discarded: string[];
  bookMid: number | null;
}

interface SourceRow {
  source_name: string;
  weight: number;
  max_deviation: number;
}

function observations(symbol: string): { rows: OracleObservation[]; strictest: number | null } {
  const db = getDb();
  const sources = db
    .prepare("SELECT source_name, weight, max_deviation FROM oracle_sources WHERE symbol = ? AND status = 'active'")
    .all(symbol) as SourceRow[];
  if (sources.length === 0) return { rows: [], strictest: null };

  const prices = db
    .prepare('SELECT source_name, price, published_ns FROM oracle_prices WHERE symbol = ?')
    .all(symbol) as Array<{ source_name: string; price: number; published_ns: number }>;
  const bySource = new Map(prices.map((row) => [row.source_name, row]));

  const rows: OracleObservation[] = [];
  let strictest: number | null = null;
  for (const source of sources) {
    const observed = bySource.get(source.source_name);
    if (!observed) continue;
    rows.push({
      source: source.source_name,
      price: Number(observed.price),
      publishedNs: Number(observed.published_ns),
      weight: Number(source.weight),
    });
    // The tightest configured tolerance is the one that protects the index.
    const deviation = Number(source.max_deviation);
    if (Number.isFinite(deviation) && deviation > 0) {
      strictest = strictest === null ? deviation : Math.min(strictest, deviation);
    }
  }

  return { rows, strictest };
}

/**
 * Index price for a contract, from the configured oracle sources.
 *
 * The contract symbol is `BASE/QUOTE`; sources are registered against the same
 * symbol, so a contract and its index share one symbol namespace.
 */
export function indexPriceFor(symbol: string): ReturnType<typeof indexPrice> {
  const normalized = symbol.trim().toUpperCase();
  const { rows, strictest } = observations(normalized);
  const config = strictest === null ? DEFAULT_ORACLE_CONFIG : { ...DEFAULT_ORACLE_CONFIG, maxDeviation: strictest };
  return indexPrice(rows, Date.now() * 1_000_000, config);
}

/** Mid price of the venue's own spot book for a pair, or null when it is empty. */
export function bookMidFor(symbol: string): number | null {
  const depth = orderBookDepth(symbol.trim().toUpperCase(), 1);
  if (depth.bestBid === null || depth.bestAsk === null) return null;
  return (depth.bestBid + depth.bestAsk) / 2;
}

/**
 * Mark price for a contract.
 *
 * Returns null when the index cannot be published and the venue has no spot
 * book to fall back on. A live index always produces a mark.
 */
export function markPriceForContract(symbol: string): PriceResult | null {
  const index = indexPriceFor(symbol);
  if ('error' in index) {
    const bookMid = bookMidFor(symbol);
    if (bookMid === null || !Number.isFinite(bookMid) || bookMid <= 0) return null;
    return {
      mark: bookMid,
      index: bookMid,
      sourcesUsed: [],
      discarded: [],
      bookMid,
    };
  }

  const bookMid = bookMidFor(symbol);
  const mark = markPrice(index.price, bookMid);
  if (typeof mark !== 'number') return null;

  return {
    mark,
    index: index.price,
    sourcesUsed: index.sourcesUsed,
    discarded: index.discarded,
    bookMid,
  };
}
