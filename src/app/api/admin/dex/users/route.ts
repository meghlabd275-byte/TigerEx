import { NextRequest, NextResponse } from 'next/server';
import { getDb, generateId } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE } from '@/lib/api/route-guards';

/**
 * DEX user administration.
 *
 * Lists the accounts that have used TigerSwap with their swap, liquidity, farm
 * and perpetual activity, and lets an administrator block or unblock an account.
 * A block is a wallet blacklist entry, which every settlement path checks.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const db = getDb();
  const users = db
    .prepare(
      `SELECT u.user_id, u.email, u.username, u.status,
              (SELECT COUNT(*) FROM dex_swaps s WHERE s.user_id = u.user_id) AS swaps,
              (SELECT COALESCE(SUM(amount_in), 0) FROM dex_swaps s WHERE s.user_id = u.user_id) AS swap_volume,
              (SELECT COUNT(*) FROM dex_lp_positions p WHERE p.user_id = u.user_id) AS liquidity_positions,
              (SELECT COUNT(*) FROM dex_farm_stakes f WHERE f.user_id = u.user_id) AS farm_stakes,
              (SELECT COUNT(*) FROM dex_perp_positions d WHERE d.user_id = u.user_id AND d.status = 'open') AS open_perps,
              EXISTS(SELECT 1 FROM dex_blacklist b WHERE b.kind = 'wallet' AND b.value = u.user_id) AS blocked
         FROM users u
        WHERE EXISTS(SELECT 1 FROM dex_swaps s WHERE s.user_id = u.user_id)
           OR EXISTS(SELECT 1 FROM dex_lp_positions p WHERE p.user_id = u.user_id)
           OR EXISTS(SELECT 1 FROM dex_perp_positions d WHERE d.user_id = u.user_id)
        ORDER BY swap_volume DESC
        LIMIT 500`,
    )
    .all() as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      users: users.map((row) => ({
        userId: row.user_id,
        email: row.email,
        username: row.username,
        status: row.status,
        swaps: row.swaps,
        swapVolume: row.swap_volume,
        liquidityPositions: row.liquidity_positions,
        farmStakes: row.farm_stakes,
        openPerps: row.open_perps,
        blocked: row.blocked === 1,
      })),
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const userId = String(body.userId ?? '').trim();
  if (!userId) return fail('VALIDATION_FAILED', 'userId is required');
  const action = String(body.action ?? '').toLowerCase();
  const db = getDb();

  if (!db.prepare('SELECT 1 FROM users WHERE user_id = ?').get(userId)) {
    return fail('UNKNOWN_USER', 'user does not exist', 404);
  }

  if (action === 'block') {
    db.prepare(
      `INSERT INTO dex_blacklist (entry_id, kind, value, reason, created_by) VALUES (?, 'wallet', ?, ?, ?)
       ON CONFLICT(kind, value) DO UPDATE SET reason = excluded.reason`,
    ).run(generateId(), userId, body.reason ? String(body.reason).slice(0, 500) : null, auth.admin.email);
    recordAdminAction(request, auth.admin, 'dex.user.block', { type: 'user', id: userId });
    return NextResponse.json({ success: true, blocked: true });
  }

  if (action === 'unblock') {
    db.prepare("DELETE FROM dex_blacklist WHERE kind = 'wallet' AND value = ?").run(userId);
    recordAdminAction(request, auth.admin, 'dex.user.unblock', { type: 'user', id: userId });
    return NextResponse.json({ success: true, blocked: false });
  }

  return fail('INVALID_ACTION', 'action must be block or unblock');
}
