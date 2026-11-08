import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listUserBots, createBot, setBotStatus, BotError } from '@/lib/bots/instances';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's grid bots.
 *
 * Grid bots are rows in the exchange's own `trading_bots` table restricted to
 * the grid strategies. Parameters are validated by the same pure planners the
 * bot engine runs with, so a bot with an inverted range cannot be stored.
 */
const GRID_STRATEGIES = ['spot_grid', 'futures_grid', 'infinity_grid'];

function isGrid(strategy: string): boolean {
  return GRID_STRATEGIES.includes(strategy);
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const bots = listUserBots(auth.user.userId).filter((bot) => isGrid(bot.strategy));
  return NextResponse.json({ success: true, bots, data: bots }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'bot.grid.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const strategy = String(body.strategy ?? body.botType ?? 'spot_grid').trim();
  if (!isGrid(strategy.toLowerCase())) {
    return fail('VALIDATION_FAILED', `strategy must be one of ${GRID_STRATEGIES.join(', ')}`);
  }

  const params: Record<string, unknown> = {
    lowerPrice: body.priceFrom ?? body.lowerPrice,
    upperPrice: body.priceTo ?? body.upperPrice,
    grids: body.gridCount ?? body.grids,
    geometric: body.geometric === true,
    quantityPerGrid: body.quantityPerGrid ?? body.quantity,
  };

  try {
    const bot = createBot(auth.user.userId, {
      strategy,
      symbol: String(body.symbol ?? body.pair ?? ''),
      params,
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

  const guard = enforceRequestGuards(request, 'bot.grid.status');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  try {
    const bot = setBotStatus(auth.user.userId, String(body.botId ?? body.id ?? ''), String(body.status ?? ''));
    return NextResponse.json({ success: true, bot, data: bot }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof BotError) return fail(error.code, error.message, error.status);
    throw error;
  }
}
