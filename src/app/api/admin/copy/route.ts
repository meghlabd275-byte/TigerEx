import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, finite, positive, parseJsonColumn, NO_STORE } from '@/lib/api/route-guards';

export const dynamic = 'force-dynamic';

/**
 * Copy-trading administration.
 *
 * A trader must be approved before followers can copy them. Approval sets the
 * follower cap and profit share; suspension stops new follows while keeping
 * existing relationships intact so open positions are not orphaned.
 */

const STATUSES = ['pending', 'approved', 'suspended', 'rejected'];

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const status = request.nextUrl.searchParams.get('status')?.trim();
  const clauses: string[] = [];
  const params: string[] = [];
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(`SELECT * FROM copy_traders${where} ORDER BY aum DESC LIMIT 1000`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      traders: rows.map((row) => ({
        traderId: row.trader_id,
        userId: row.user_id,
        displayName: row.display_name,
        markets: parseJsonColumn<string[]>(row.markets, []),
        roi7d: row.roi_7d,
        roi30d: row.roi_30d,
        roi90d: row.roi_90d,
        winRate: row.win_rate,
        followers: row.followers,
        maxFollowers: row.max_followers,
        aum: row.aum,
        profitShare: row.profit_share,
        status: row.status,
        approvedBy: row.approved_by ?? null,
        createdAt: row.created_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/** Approve, suspend or reject a copy-trading leader. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.copy');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const traderId = typeof body.traderId === 'string' ? body.traderId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(traderId)) return fail('VALIDATION_FAILED', 'Invalid trader id');

  const status = String(body.status ?? '').toLowerCase();
  if (!STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  const maxFollowers = body.maxFollowers === undefined ? null : finite(body.maxFollowers);
  if (body.maxFollowers !== undefined && (maxFollowers === null || !Number.isInteger(maxFollowers) || maxFollowers < 0 || maxFollowers > 100000)) {
    return fail('VALIDATION_FAILED', 'maxFollowers must be an integer in [0, 100000]');
  }

  const profitShare = body.profitShare === undefined ? null : finite(body.profitShare);
  if (body.profitShare !== undefined && (profitShare === null || profitShare < 0 || profitShare >= 1)) {
    return fail('VALIDATION_FAILED', 'profitShare must be a fraction in [0, 1)');
  }

  const db = getDb();
  const trader = db.prepare('SELECT status FROM copy_traders WHERE trader_id = ?').get(traderId) as
    | { status: string }
    | undefined;
  if (!trader) return fail('UNKNOWN_TRADER', 'No such copy trader', 404);

  db.prepare(
    `UPDATE copy_traders
        SET status = ?, max_followers = COALESCE(?, max_followers), profit_share = COALESCE(?, profit_share),
            approved_by = ?
      WHERE trader_id = ?`,
  ).run(status, maxFollowers, profitShare, auth.admin.email, traderId);

  recordAdminAction(request, auth.admin, 'copy.trader.status', {
    type: 'copy_trader',
    id: traderId,
    detail: { from: trader.status, to: status, maxFollowers, profitShare },
  });

  return NextResponse.json({ success: true, traderId, status }, { headers: NO_STORE });
}
