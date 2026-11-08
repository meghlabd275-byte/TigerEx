import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listUserBots, createBot, setBotStatus, BotError } from '@/lib/bots/instances';
import { fail, readJson, enforceRequestGuards, NO_STORE } from '@/lib/api/route-guards';

/**
 * The caller's DCA and martingale bots.
 *
 * Bots are rows in the exchange's own `trading_bots` table restricted to the
 * averaging strategies. The amount and interval are validated by the same pure
 * planner the bot engine runs with before the row is written.
 */
const DCA_STRATEGIES = ['dca', 'martingale'];

function isDca(strategy: string): boolean {
  return DCA_STRATEGIES.includes(strategy);
}

export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const bots = listUserBots(auth.user.userId).filter((bot) => isDca(bot.strategy));
  return NextResponse.json({ success: true, bots, data: bots }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const guard = enforceRequestGuards(request, 'bot.dca.create');
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const strategy = String(body.strategy ?? body.botType ?? 'dca').trim();
  if (!isDca(strategy.toLowerCase())) {
    return fail('VALIDATION_FAILED', `strategy must be one of ${DCA_STRATEGIES.join(', ')}`);
  }

  // `frequency` is accepted as an interval name and converted to nanoseconds so
  // the stored params match what the engine schedules against.
  const intervalNs = (() => {
    if (body.intervalNs !== undefined) return Number(body.intervalNs);
    const frequency = String(body.frequency ?? '').trim().toLowerCase();
    const table: Record<string, number> = {
      hourly: 3_600_000_000_000,
      daily: 86_400_000_000_000,
      weekly: 604_800_000_000_000,
      monthly: 2_592_000_000_000_000,
    };
    return table[frequency] ?? Number.NaN;
  })();

  const params: Record<string, unknown> = {
    amount: body.amount,
    intervalNs,
    multiplier: body.multiplier ?? body.martingaleMultiplier,
    maxAmount: body.maxAmount ?? body.totalOrders,
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

  const guard = enforceRequestGuards(request, 'bot.dca.status');
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
