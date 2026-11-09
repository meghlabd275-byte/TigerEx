import { NextRequest, NextResponse } from 'next/server';
import { enforceRequestGuards } from '@/lib/api/route-guards';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { validateDexTokenInput } from '@/lib/dex/validation';

/**
 * TigerSwap token listing administration.
 *
 * Every mutation is authenticated as an administrator, validated, written to
 * `dex_tokens` and appended to the immutable audit trail.
 */
function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const rows = getDb().prepare('SELECT * FROM dex_tokens ORDER BY symbol').all() as Array<Record<string, unknown>>;
  return NextResponse.json(
    {
      success: true,
      tokens: rows.map((row) => ({
        symbol: row.symbol,
        name: row.name,
        decimals: row.decimals,
        chain: row.chain,
        contractAddress: row.contract_address,
        logoUrl: row.logo_url,
        coingeckoId: row.coingecko_id,
        priceFeed: row.price_feed,
        tags: row.tags ? JSON.parse(String(row.tags)) : [],
        verified: row.verified === 1,
        spam: row.spam === 1,
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
  const guard = enforceRequestGuards(request, 'admin.dex.tokens.post');
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }
  const validated = validateDexTokenInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const token = validated.value;

  const db = getDb();
  if (db.prepare('SELECT 1 FROM dex_tokens WHERE symbol = ?').get(token.symbol)) {
    return fail('DUPLICATE_SYMBOL', `${token.symbol} is already listed`, 409);
  }
  db.prepare(
    `INSERT INTO dex_tokens
       (token_id, symbol, name, decimals, chain, contract_address, logo_url, coingecko_id, price_feed, tags, verified, spam, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    token.symbol,
    token.name,
    token.decimals,
    token.chain,
    token.contractAddress,
    token.logoUrl,
    token.coingeckoId,
    token.priceFeed,
    JSON.stringify(token.tags),
    token.verified ? 1 : 0,
    token.spam ? 1 : 0,
    token.status,
  );
  recordAdminAction(request, auth.admin, 'dex.token.list', { type: 'dex_token', id: token.symbol, detail: token });
  return NextResponse.json({ success: true, token }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.dex.tokens.put');
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail('INVALID_BODY', 'A JSON body is required');
  }
  const validated = validateDexTokenInput(body);
  if ('error' in validated) return fail('VALIDATION_FAILED', validated.error);
  const token = validated.value;

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM dex_tokens WHERE symbol = ?').get(token.symbol)) {
    return fail('UNKNOWN_TOKEN', `${token.symbol} is not listed`, 404);
  }
  db.prepare(
    `UPDATE dex_tokens SET name = ?, decimals = ?, chain = ?, contract_address = ?, logo_url = ?,
        coingecko_id = ?, price_feed = ?, tags = ?, verified = ?, spam = ?, status = ? WHERE symbol = ?`,
  ).run(
    token.name,
    token.decimals,
    token.chain,
    token.contractAddress,
    token.logoUrl,
    token.coingeckoId,
    token.priceFeed,
    JSON.stringify(token.tags),
    token.verified ? 1 : 0,
    token.spam ? 1 : 0,
    token.status,
    token.symbol,
  );
  recordAdminAction(request, auth.admin, 'dex.token.update', { type: 'dex_token', id: token.symbol, detail: token });
  return NextResponse.json({ success: true, token });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.dex.tokens.delete');
  if (guard) return guard;

  const symbol = request.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  if (!symbol) return fail('VALIDATION_FAILED', 'symbol query parameter is required');

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM dex_tokens WHERE symbol = ?').get(symbol)) {
    return fail('UNKNOWN_TOKEN', `${symbol} is not listed`, 404);
  }
  const pools = db.prepare('SELECT tokens FROM dex_pools').all() as Array<{ tokens: string }>;
  const inPool = pools.some((pool) => (JSON.parse(pool.tokens) as string[]).includes(symbol));
  if (inPool) return fail('TOKEN_IN_POOL', `${symbol} is in a live pool; remove it from the pool first`, 409);

  db.prepare("UPDATE dex_tokens SET status = 'delisted' WHERE symbol = ?").run(symbol);
  recordAdminAction(request, auth.admin, 'dex.token.delist', { type: 'dex_token', id: symbol });
  return NextResponse.json({ success: true, symbol });
}
