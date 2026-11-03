import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, finite, positive, upper, NO_STORE } from '@/lib/api/route-guards';
import { indexPrice, type OracleObservation } from '@/lib/oracle/aggregator';

/**
 * Oracle source administration.
 *
 * The index price is the weighted median of the configured sources. This route
 * manages the source list and their last observations, and can preview the
 * aggregate for a symbol so an operator can see a deviation before it trips the
 * automatic pause.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const sources = db
    .prepare('SELECT * FROM oracle_sources ORDER BY symbol, source_name')
    .all() as Array<Record<string, unknown>>;
  const prices = db
    .prepare('SELECT * FROM oracle_prices ORDER BY symbol, source_name')
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      sources: sources.map((row) => ({
        sourceId: row.source_id,
        symbol: row.symbol,
        sourceName: row.source_name,
        feedReference: row.feed_reference ?? null,
        weight: row.weight,
        maxDeviation: row.max_deviation,
        status: row.status,
      })),
      prices: prices.map((row) => ({
        symbol: row.symbol,
        sourceName: row.source_name,
        price: row.price,
        confidence: row.confidence,
        publishedNs: row.published_ns,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Add or update an oracle source for a symbol. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.oracle');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const symbol = upper(body.symbol);
  if (!/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(symbol)) {
    return fail('VALIDATION_FAILED', 'symbol must be of the form BASE/QUOTE');
  }

  const sourceName = upper(body.sourceName);
  if (!/^[A-Z0-9_]{1,40}$/.test(sourceName)) {
    return fail('VALIDATION_FAILED', 'sourceName must be 1-40 characters of A-Z, 0-9 or underscore');
  }

  const weight = positive(body.weight ?? 1);
  if (weight === null || weight > 1000) return fail('VALIDATION_FAILED', 'weight must be a positive number');

  const maxDeviation = finite(body.maxDeviation ?? 0.05);
  if (maxDeviation === null || maxDeviation <= 0 || maxDeviation >= 1) {
    return fail('VALIDATION_FAILED', 'maxDeviation must be a fraction in (0, 1)');
  }

  const feedReference = body.feedReference === undefined ? null : String(body.feedReference).slice(0, 200);
  const status = String(body.status ?? 'active').toLowerCase();
  if (!['active', 'paused'].includes(status)) {
    return fail('VALIDATION_FAILED', 'status must be active or paused');
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT source_id FROM oracle_sources WHERE symbol = ? AND source_name = ?')
    .get(symbol, sourceName) as { source_id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE oracle_sources SET feed_reference = ?, weight = ?, max_deviation = ?, status = ?
        WHERE source_id = ?`,
    ).run(feedReference, weight, maxDeviation, status, existing.source_id);
  } else {
    db.prepare(
      `INSERT INTO oracle_sources (source_id, symbol, source_name, feed_reference, weight, max_deviation, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(generateId(), symbol, sourceName, feedReference, weight, maxDeviation, status);
  }

  recordAdminAction(request, auth.admin, 'oracle.source.set', {
    type: 'oracle_source',
    id: `${symbol}:${sourceName}`,
    detail: { weight, maxDeviation, status },
  });

  return NextResponse.json({ success: true, symbol, sourceName, weight, maxDeviation, status }, { headers: NO_STORE });
}

/**
 * Record an observation for a source, or preview the aggregate.
 *
 * With `price` the observation is stored; without it the current aggregate for
 * the symbol is returned, computed exactly as the execution path computes it.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.oracle.publish');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const symbol = upper(body.symbol);
  if (!/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(symbol)) {
    return fail('VALIDATION_FAILED', 'symbol must be of the form BASE/QUOTE');
  }

  const db = getDb();
  const configs = db
    .prepare('SELECT source_name, weight, max_deviation, status FROM oracle_sources WHERE symbol = ?')
    .all(symbol) as Array<{ source_name: string; weight: number; max_deviation: number; status: string }>;

  if (configs.length === 0) {
    return fail('NO_SOURCES', `${symbol} has no oracle sources configured`, 404);
  }

  if (body.price !== undefined) {
    const sourceName = upper(body.sourceName);
    const config = configs.find((c) => c.source_name === sourceName);
    if (!config) return fail('UNKNOWN_SOURCE', `${sourceName} is not configured for ${symbol}`, 404);

    const price = positive(body.price);
    if (price === null) return fail('VALIDATION_FAILED', 'price must be a positive number');

    const confidence = finite(body.confidence ?? 0) ?? 0;
    const publishedNs = Number.isInteger(body.publishedNs) ? Number(body.publishedNs) : Date.now() * 1e6;

    db.prepare(
      `INSERT INTO oracle_prices (price_id, symbol, source_name, price, confidence, published_ns)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, source_name) DO UPDATE SET
         price = excluded.price, confidence = excluded.confidence, published_ns = excluded.published_ns`,
    ).run(generateId(), symbol, sourceName, price, confidence, publishedNs);
  }

  const rows = db
    .prepare('SELECT source_name, price, confidence, published_ns FROM oracle_prices WHERE symbol = ?')
    .all(symbol) as Array<{ source_name: string; price: number; confidence: number; published_ns: number }>;

  const observations: OracleObservation[] = rows.map((row) => ({
    source: row.source_name,
    price: Number(row.price),
    weight: configs.find((c) => c.source_name === row.source_name)?.weight ?? 1,
    publishedNs: Number(row.published_ns),
    maxDeviation: configs.find((c) => c.source_name === row.source_name)?.max_deviation ?? 0.05,
  }));

  const aggregate = indexPrice(observations, Date.now() * 1e6);

  recordAdminAction(request, auth.admin, 'oracle.aggregate', {
    type: 'oracle_symbol',
    id: symbol,
    detail: { sources: observations.length },
  });

  return NextResponse.json({ success: true, symbol, aggregate }, { headers: NO_STORE });
}
