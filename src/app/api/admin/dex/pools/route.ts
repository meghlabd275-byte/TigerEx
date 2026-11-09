import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { validatePoolInput, validatePoolUpdate } from '@/lib/dex/validation';
import { refreshPoolStats } from '@/lib/dex/pool-service';
import { v3LiquidityForAmounts } from '@/lib/dex/amm';

/**
 * TigerSwap pool administration.
 *
 * Create a pool of any kind (V2, concentrated, stable, weighted), pause or
 * resume it, and adjust its fee. Every mutation is validated, written to
 * `dex_pools` and appended to the audit trail. The address is derived from the
 * pool's own parameters rather than copied from another venue.
 */
function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

function poolAddress(kind: string, tokens: string[], fee: number): string {
  // A deterministic, venue-local identifier; not an on-chain address.
  const seed = `${kind}:${tokens.join('-')}:${fee}`;
  let hash = 0n;
  for (const ch of seed) hash = (hash * 31n + BigInt(ch.charCodeAt(0))) % (1n << 160n);
  return `0x${hash.toString(16).padStart(40, '0')}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const rows = getDb().prepare('SELECT * FROM dex_pools ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
  return NextResponse.json(
    {
      success: true,
      pools: rows.map((row) => ({
        poolId: row.pool_id,
        kind: row.kind,
        address: row.address,
        tokens: JSON.parse(String(row.tokens)),
        fee: row.fee,
        amplification: row.amplification,
        weights: row.weights ? JSON.parse(String(row.weights)) : null,
        tickSpacing: row.tick_spacing,
        sqrtPrice: row.sqrt_price,
        liquidity: row.liquidity,
        reserves: JSON.parse(String(row.reserves)),
        totalSupply: row.total_supply,
        tvlUsd: row.tvl_usd,
        volume24hUsd: row.volume_24h_usd,
        fee24hUsd: row.fee_24h_usd,
        status: row.status,
        createdAt: row.created_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }
  const validated = validatePoolInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const pool = validated.value;

  const db = getDb();
  const address = poolAddress(pool.kind, pool.tokens, pool.fee);
  if (db.prepare('SELECT 1 FROM dex_pools WHERE address = ?').get(address)) {
    return fail('DUPLICATE_POOL', 'a pool with these parameters already exists', 409);
  }

  const poolId = generateId();
  const totalSupply = pool.kind === 'v2'
    ? Math.sqrt(pool.reserves[pool.tokens[0]] * pool.reserves[pool.tokens[1]])
    : pool.kind === 'v3'
      ? 0
      : pool.reserves[pool.tokens[0]];

  // A concentrated pool prices a swap from its active liquidity, so a pool
  // created with zero liquidity could never be quoted or traded — every swap
  // would fail until someone added a position. The reserves the admin seeded
  // are therefore converted into liquidity over the pool's own range here.
  let liquidity = 0;
  if (pool.kind === 'v3' && pool.sqrtPrice !== null && pool.sqrtPriceLower !== null && pool.sqrtPriceUpper !== null) {
    liquidity = v3LiquidityForAmounts(
      pool.reserves[pool.tokens[0]],
      pool.reserves[pool.tokens[1]],
      pool.sqrtPrice,
      pool.sqrtPriceLower,
      pool.sqrtPriceUpper,
    );
    if (!Number.isFinite(liquidity) || liquidity <= 0) {
      return fail('VALIDATION_FAILED', 'the seeded reserves cannot back any liquidity over this price range');
    }
  }

  db.prepare(
    `INSERT INTO dex_pools
       (pool_id, kind, address, tokens, fee, amplification, weights, tick_spacing, sqrt_price, liquidity,
        sqrt_price_lower, sqrt_price_upper, reserves, total_supply, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    poolId,
    pool.kind,
    address,
    JSON.stringify(pool.tokens),
    pool.fee,
    pool.amplification,
    pool.weights ? JSON.stringify(pool.weights) : null,
    pool.tickSpacing,
    pool.sqrtPrice,
    liquidity,
    pool.sqrtPriceLower,
    pool.sqrtPriceUpper,
    JSON.stringify(pool.reserves),
    pool.kind === 'v3' ? liquidity : totalSupply,
    pool.status,
    auth.admin.adminId,
  );
  refreshPoolStats(poolId);
  recordAdminAction(request, auth.admin, 'dex.pool.create', { type: 'dex_pool', id: poolId, detail: pool });
  return NextResponse.json({ success: true, poolId, address }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }
  const poolId = String(body.poolId ?? '');
  const db = getDb();
  const existing = db.prepare('SELECT * FROM dex_pools WHERE pool_id = ?').get(poolId) as Record<string, unknown> | undefined;
  if (!existing) return fail('UNKNOWN_POOL', 'pool does not exist', 404);

  // A partial update must never require the caller to resend tokens or
  // reserves: rewriting them from a request that omitted them would silently
  // zero the pool. Only the fields actually present are validated and written.
  const validated = validatePoolUpdate(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const update = validated.value;

  const kind = String(existing.kind);
  const columns: Record<string, string> = {
    fee: 'fee',
    status: 'status',
    amplification: 'amplification',
    weights: 'weights',
    sqrtPrice: 'sqrt_price',
  };

  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in update)) continue;
    if (key === 'amplification' && kind !== 'stable') {
      return fail('VALIDATION_FAILED', 'amplification only applies to a stable pool');
    }
    if (key === 'weights' && kind !== 'weighted') {
      return fail('VALIDATION_FAILED', 'weights only apply to a weighted pool');
    }
    if (key === 'sqrtPrice' && kind !== 'v3') {
      return fail('VALIDATION_FAILED', 'a price range only applies to a concentrated pool');
    }
    const raw = (update as Record<string, unknown>)[key];
    assignments.push(`${column} = ?`);
    params.push(Array.isArray(raw) ? JSON.stringify(raw) : raw);
  }
  if ('sqrtPriceLower' in update) {
    assignments.push('sqrt_price_lower = ?');
    params.push(update.sqrtPriceLower);
    assignments.push('sqrt_price_upper = ?');
    params.push(update.sqrtPriceUpper);
  }

  params.push(poolId);
  db.prepare(`UPDATE dex_pools SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE pool_id = ?`).run(...params);
  recordAdminAction(request, auth.admin, 'dex.pool.update', { type: 'dex_pool', id: poolId, detail: update });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const poolId = request.nextUrl.searchParams.get('poolId')?.trim();
  if (!poolId) return fail('VALIDATION_FAILED', 'poolId query parameter is required');

  const db = getDb();
  const pool = db.prepare('SELECT * FROM dex_pools WHERE pool_id = ?').get(poolId) as { reserves: string; tokens: string } | undefined;
  if (!pool) return fail('UNKNOWN_POOL', 'pool does not exist', 404);

  const openPositions = db.prepare('SELECT COUNT(*) AS n FROM dex_lp_positions WHERE pool_id = ?').get(poolId) as { n: number };
  if (openPositions.n > 0) {
    return fail('LIQUIDITY_PRESENT', `${openPositions.n} liquidity position(s) remain; they must be withdrawn first`, 409);
  }
  db.prepare("UPDATE dex_pools SET status = 'delisted', updated_at = datetime('now') WHERE pool_id = ?").run(poolId);
  recordAdminAction(request, auth.admin, 'dex.pool.delist', { type: 'dex_pool', id: poolId });
  return NextResponse.json({ success: true, poolId });
}
