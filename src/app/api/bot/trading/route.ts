import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listUserBots, createBot, setBotStatus, BotError } from '@/lib/bots/instances';
import { runBotTick, type BotRow } from '@/lib/bots/runner';
import { getDb } from '@/lib/db';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's trading bots.
 *
 * Bots are the exchange's own `trading_bots` rows; the strategy parameters are
 * validated with the same pure planners the bot engine runs with, so a bot
 * cannot be stored in a state the engine would refuse to run.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const bots = listUserBots(auth.user.userId);
  return NextResponse.json({ success: true, bots, data: bots }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'bot.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const strategy = String(body.strategy ?? body.botType ?? body.type ?? '').trim();
  const symbol = String(body.symbol ?? body.pair ?? '').trim();
  const params = (body.params ?? body.config ?? {}) as Record<string, unknown>;

  try {
    const bot = createBot(auth.user.userId, { strategy, symbol, params, status: String(body.status ?? 'stopped') });
    return NextResponse.json({ success: true, bot, data: bot }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof BotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

/** Start, pause or stop one of the caller's bots. */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'bot.status');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const botId = String(body.botId ?? body.id ?? '').trim();

  // An explicit tick lets the owner advance a bot without waiting for the
  // scheduler; it runs the same planner and engine the scheduler does.
  if (body.action === 'tick') {
    if (!botId) return fail('VALIDATION_FAILED', 'botId is required');
    const row = getDb()
      .prepare(
        'SELECT bot_id, user_id, strategy, symbol, params, status, state, last_run_ns FROM trading_bots WHERE bot_id = ? AND user_id = ?',
      )
      .get(botId, auth.user.userId) as BotRow | undefined;
    if (!row) return fail('UNKNOWN_BOT', 'No such bot for this account', 404);
    if (row.status !== 'running') return fail('NOT_RUNNING', 'Only a running bot can be ticked', 409);
    try {
      const result = runBotTick(row);
      return NextResponse.json({ success: true, result }, { headers: NO_STORE });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bot tick failed';
      return fail('BOT_TICK_FAILED', message, 500);
    }
  }

  try {
    const bot = setBotStatus(auth.user.userId, botId, String(body.status ?? ''));
    return NextResponse.json({ success: true, bot, data: bot }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof BotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
