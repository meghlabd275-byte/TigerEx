import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { enforceRequestGuards, readJson, fail, NO_STORE } from '@/lib/api/route-guards';
import { dexFailure } from '@/lib/dex/route-helpers';
import {
  listBotInstances,
  createBotInstance,
  setBotInstanceStatus,
  deleteBotInstance,
  evaluateBotInstance,
  scanArbitrage,
  runArbitrage,
  scanLiquidations,
  runLiquidation,
} from '@/lib/dex/bot-service';

/**
 * TigerSwap trading bots.
 *
 * `GET` lists the caller's bot instances and the venue-wide arbitrage and
 * liquidation opportunities. `POST` creates an instance, changes its status,
 * removes it, evaluates it against live state, or runs the strategies that
 * settle trades (arbitrage and liquidation). Every settlement goes through the
 * same swap and lending services the rest of the venue uses.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(
      {
        success: true,
        instances: listBotInstances(auth.user.userId),
        opportunities: scanArbitrage(10_000),
        liquidations: scanLiquidations(),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return dexFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;
  const guard = enforceRequestGuards(request, 'dex.bots', 60, 60_000);
  if (guard) return guard;

  const body = await readJson(request);
  if (!body) return fail('INVALID_BODY', 'A JSON object body is required');

  const action = String(body.action ?? '').toLowerCase();
  const userId = auth.user.userId;
  try {
    switch (action) {
      case 'create':
        return NextResponse.json(
          { success: true, instance: createBotInstance(userId, { botType: body.botType, poolId: body.poolId, params: body.params }) },
          { status: 201, headers: NO_STORE },
        );
      case 'status':
        return NextResponse.json(
          { success: true, instance: setBotInstanceStatus(userId, String(body.instanceId ?? ''), body.status) },
          { headers: NO_STORE },
        );
      case 'delete':
        return NextResponse.json(
          { success: true, ...deleteBotInstance(userId, String(body.instanceId ?? '')) },
          { headers: NO_STORE },
        );
      case 'evaluate': {
        const instance = listBotInstances(userId).find((i) => i.instanceId === String(body.instanceId ?? ''));
        if (!instance) return fail('UNKNOWN_INSTANCE', 'bot instance does not exist', 404);
        return NextResponse.json({ success: true, decision: evaluateBotInstance(instance) }, { headers: NO_STORE });
      }
      case 'arbitrage':
        return NextResponse.json(
          {
            success: true,
            result: runArbitrage(userId, {
              tokenIn: body.tokenIn,
              tokenOut: body.tokenOut,
              buyPoolId: body.buyPoolId,
              sellPoolId: body.sellPoolId,
              maxAmountIn: body.maxAmountIn,
            }),
          },
          { status: 201, headers: NO_STORE },
        );
      case 'liquidate':
        return NextResponse.json(
          { success: true, result: runLiquidation(userId, body.positionId, body.collateralAsset) },
          { status: 201, headers: NO_STORE },
        );
      default:
        return fail('INVALID_ACTION', 'action must be create, status, delete, evaluate, arbitrage or liquidate');
    }
  } catch (error) {
    return dexFailure(error);
  }
}
