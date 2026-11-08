import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { listPositions, getOptionsMarket, quoteContract, OptionsError } from '@/lib/options/options-engine';
import { NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * A mark-to-market quote for each of the caller's open positions.
 *
 * The quote is the model premium for the position's contract, so the caller can
 * see the value of what they hold without a second round trip.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const positions = listPositions(auth.user.userId);
  const quotes = positions
    .map((position) => {
      const market = getOptionsMarket(position.symbol);
      if (!market) return null;
      try {
        return { positionId: position.positionId, ...quoteContract(market) };
      } catch (error) {
        if (error instanceof OptionsError) return null;
        throw error;
      }
    })
    .filter((quote): quote is NonNullable<typeof quote> => quote !== null);

  return NextResponse.json({ success: true, quotes, data: quotes }, { headers: NO_STORE });
}
