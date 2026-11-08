import { NextRequest, NextResponse } from 'next/server';
import { listEtfMarkets, getEtfMarket, quoteToken, EtfError } from '@/lib/trading/etf-engine';
import { NO_STORE, fail } from '@/lib/api/route-guards';

/**
 * Leveraged-token listings and their live NAV.
 *
 * The NAV is marked against the underlying's observable spot price and the
 * accrued management fee, so a token's value reflects the real underlying move
 * rather than a stored figure.
 */
export async function GET(request: NextRequest) {
  const tokenName = request.nextUrl.searchParams.get('tokenName')?.trim();

  if (tokenName) {
    const market = getEtfMarket(tokenName);
    if (!market) return fail('UNKNOWN_TOKEN', `${tokenName.toUpperCase()} is not a listed token`, 404);
    try {
      const quote = quoteToken(market);
      return NextResponse.json({ success: true, token: quote, data: quote }, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof EtfError) return fail(error.code, error.message, error.status);
      throw error;
    }
  }

  const tokens = listEtfMarkets().map((market) => {
    try {
      return quoteToken(market);
    } catch {
      return {
        symbol: market.symbol,
        nav: market.nav,
        leverage: market.leverage,
        underlying: market.underlying,
        underlyingPrice: null,
        settlementAsset: market.settlementAsset,
      };
    }
  });

  return NextResponse.json({ success: true, tokens, data: tokens }, { headers: NO_STORE });
}
