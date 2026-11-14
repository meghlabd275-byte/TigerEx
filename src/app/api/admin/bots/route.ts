import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, enforceRequestGuards, parseJsonColumn, NO_STORE } from '@/lib/api/route-guards';
import { gridLevels, twapSlices, type GridConfig, type TwapConfig } from '@/lib/bots/strategies';

export const dynamic = 'force-dynamic';

/**
 * Bot administration.
 *
 * Lists running bot instances and lets an operator stop or resume one. Stopping
 * a bot is an administrative action and is audited; the bot engine reads the
 * status before placing its next order.
 */

const STATUSES = ['stopped', 'running', 'paused'];

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
    .prepare(`SELECT * FROM trading_bots${where} ORDER BY created_at DESC LIMIT 1000`)
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      bots: rows.map((row) => ({
        botId: row.bot_id,
        userId: row.user_id,
        strategy: row.strategy,
        symbol: row.symbol,
        params: parseJsonColumn<Record<string, unknown>>(row.params, {}),
        status: row.status,
        realizedPnl: row.realized_pnl,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/**
 * Preview a bot's planned orders for its parameters.
 *
 * The grid and TWAP plans are computed by the same pure functions the bot
 * engine uses, so the operator sees exactly what would be placed.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'admin.bots');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const botId = typeof body.botId === 'string' ? body.botId.trim() : '';
  const preview = body.preview === true;

  if (preview) {
    const strategy = String(body.strategy ?? '').toLowerCase();
    const params = (body.params ?? {}) as Record<string, unknown>;
    if (strategy === 'grid') {
      const plan = gridLevels(params as unknown as GridConfig);
      if ('error' in plan) return fail('VALIDATION_FAILED', plan.error);
      return NextResponse.json({ success: true, strategy, levels: plan }, { headers: NO_STORE });
    }
    if (strategy === 'twap') {
      const plan = twapSlices(params as unknown as TwapConfig);
      if ('error' in plan) return fail('VALIDATION_FAILED', plan.error);
      return NextResponse.json({ success: true, strategy, slices: plan }, { headers: NO_STORE });
    }
    return fail('VALIDATION_FAILED', 'strategy must be grid or twap for a preview');
  }

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId)) return fail('VALIDATION_FAILED', 'Invalid bot id');
  const status = String(body.status ?? '').toLowerCase();
  if (!STATUSES.includes(status)) {
    return fail('VALIDATION_FAILED', `status must be one of ${STATUSES.join(', ')}`);
  }

  const db = getDb();
  const bot = db.prepare('SELECT status FROM trading_bots WHERE bot_id = ?').get(botId) as
    | { status: string }
    | undefined;
  if (!bot) return fail('UNKNOWN_BOT', 'No such bot', 404);

  db.prepare("UPDATE trading_bots SET status = ?, updated_at = datetime('now') WHERE bot_id = ?").run(status, botId);

  recordAdminAction(request, auth.admin, 'bot.status', {
    type: 'trading_bot',
    id: botId,
    detail: { from: bot.status, to: status },
  });

  return NextResponse.json({ success: true, botId, status }, { headers: NO_STORE });
}
