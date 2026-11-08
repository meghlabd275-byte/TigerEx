import { NextRequest, NextResponse } from 'next/server';
import { listOptionsMarkets, getOptionsMarket, quoteContract, OptionsError } from '@/lib/options/options-engine';
import { NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * Options pricing.
 *
 * The premium is the venue's Black-Scholes mark for the contract, computed from
 * the underlying's observable spot price and the contract's listed implied
 * volatility. A contract whose underlying has no price is refused rather than
 * quoted at an invented figure.
 */
export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol')?.trim();

  if (symbol) {
    const market = getOptionsMarket(symbol);
    if (!market) return fail('UNKNOWN_CONTRACT', `${symbol.toUpperCase()} is not a listed contract`, 404);
    try {
      const quote = quoteContract(market);
      return NextResponse.json({ success: true, quote, data: quote }, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof OptionsError) return fail(error.code, error.message, error.status);
      throw error;
    }
  }

  const underlying = request.nextUrl.searchParams.get('underlying') ?? undefined;
  const markets = listOptionsMarkets({ underlying });
  const quotes = markets.map((market) => {
    try {
      return quoteContract(market);
    } catch {
      return null;
    }
  }).filter((quote): quote is NonNullable<typeof quote> => quote !== null);

  return NextResponse.json({ success: true, quotes, data: quotes }, { headers: NO_STORE });
}
