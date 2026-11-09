import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdmin, recordAdminAction } from '@/lib/auth/admin';
import { fail, readJson, NO_STORE } from '@/lib/api/route-guards';
import { DexError } from '@/lib/dex/pool-service';
import { evaluateBotInstance } from '@/lib/dex/bot-service';

/**
 * DEX bot administration.
 *
 * Lists every TigerSwap bot instance across all users with its owner and
 * status, and lets an operator pause or stop one. Stopping a bot is an
 * administrative action and is audited; the bot engine reads the status before
 * its next decision.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const botType = request.nextUrl.searchParams.get('botType')?.trim();
  const status = request.nextUrl.searchParams.get('status')?.trim();
  const clauses: string[] = [];
  const params: string[] = [];
  if (botType) {
    clauses.push('b.bot_type = ?');
    params.push(botType);
  }
  if (status) {
    clauses.push('b.status = ?');
    params.push(status);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = getDb()
    .prepare(
      `SELECT b.*, u.email AS owner_email FROM dex_bot_instances b
         LEFT JOIN users u ON u.user_id = b.user_id${where} ORDER BY b.created_at DESC LIMIT 1000`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  return NextResponse.json(
    {
      success: true,
      instances: rows.map((row) => ({
        instanceId: row.instance_id,
        userId: row.user_id,
        ownerEmail: row.owner_email,
        botType: row.bot_type,
        poolId: row.pool_id,
        params: JSON.parse(String(row.params)) as Record<string, unknown>,
        state: JSON.parse(String(row.state)) as Record<string, unknown>,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    },
    { headers: NO_STORE },
  );
}

/**
 * Preview a bot instance's next decision, or change its status.
 *
 * A decision is computed by the same pure planner the bot runs with, so the
 * operator sees exactly what the instance would do against live state.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ('error' in auth) return auth.error;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const instanceId = String(body.instanceId ?? '').trim();
  if (!instanceId) return fail('VALIDATION_FAILED', 'instanceId is required');

  const row = getDb().prepare('SELECT * FROM dex_bot_instances WHERE instance_id = ?').get(instanceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return fail('UNKNOWN_INSTANCE', 'bot instance does not exist', 404);

  const action = String(body.action ?? 'preview').toLowerCase();
  try {
    if (action === 'preview') {
      const instance = {
        instanceId: row.instance_id,
        botType: row.bot_type,
        poolId: row.pool_id,
        params: JSON.parse(String(row.params)) as Record<string, unknown>,
        state: JSON.parse(String(row.state)) as Record<string, unknown>,
        status: row.status,
      };
      return NextResponse.json({ success: true, decision: evaluateBotInstance(instance) }, { headers: NO_STORE });
    }

    if (action === 'status') {
      const next = String(body.status ?? '').toLowerCase();
      if (!['active', 'paused', 'stopped'].includes(next)) {
        return fail('VALIDATION_FAILED', 'status must be active, paused or stopped');
      }
      getDb()
        .prepare("UPDATE dex_bot_instances SET status = ?, updated_at = datetime('now') WHERE instance_id = ?")
        .run(next, instanceId);
      recordAdminAction(request, auth.admin, 'dex.bot.status', { type: 'dex_bot', id: instanceId, detail: { status: next } });
      return NextResponse.json({ success: true, instanceId, status: next }, { headers: NO_STORE });
    }

    return fail('INVALID_ACTION', 'action must be preview or status');
  } catch (error) {
    if (error instanceof DexError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
