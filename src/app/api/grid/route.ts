import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listUserBots, createBot, setBotStatus, BotError } from '@/lib/bots/instances';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * Grid trading.
 *
 * A grid bot is an ordinary `trading_bots` row with a grid strategy, so the
 * same engine, validation and lifecycle apply. GET lists the caller's grid
 * bots; POST creates one; PUT starts, pauses or stops one.
 */
const GRID_STRATEGIES = new Set(['spot_grid', 'futures_grid', 'infinity_grid']);

function gridBots(userId: string) {
  return listUserBots(userId).filter((bot) => GRID_STRATEGIES.has(bot.strategy));
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const bots = gridBots(auth.user.userId);
  return NextResponse.json({ success: true, bots, data: bots }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'grid.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const strategy = String(body.strategy ?? body.botType ?? 'spot_grid').trim();
  if (!GRID_STRATEGIES.has(strategy)) {
    return fail('VALIDATION_FAILED', 'strategy must be spot_grid, futures_grid or infinity_grid');
  }

  try {
    const bot = createBot(auth.user.userId, {
      strategy,
      symbol: String(body.symbol ?? body.pair ?? ''),
      params: (body.params ?? body.config ?? {}) as Record<string, unknown>,
      status: String(body.status ?? 'stopped'),
    });
    return NextResponse.json({ success: true, bot, data: bot }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof BotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'grid.status');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const botId = String(body.botId ?? body.id ?? '');
  const existing = gridBots(auth.user.userId).find((bot) => bot.id === botId);
  if (!existing) return fail('UNKNOWN_BOT', 'No such grid bot for this account', 404);

  try {
    const bot = setBotStatus(auth.user.userId, botId, String(body.status ?? ''));
    return NextResponse.json({ success: true, bot, data: bot }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof BotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
