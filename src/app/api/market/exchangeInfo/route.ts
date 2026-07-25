import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Get Exchange Info - Production Implementation
 * Returns trading pairs and market info from database
 */
export async function GET() {
  try {
    const db = getDb();
    
    // Get all trading pairs
    const pairs = db.prepare(`
      SELECT * FROM trading_pairs WHERE status = 'active'
    `).all();
    
    // Get market data for each pair
    const symbols = db.prepare(`
      SELECT * FROM market_data
    `).all();
    
    const symbolMap = new Map((symbols as any[]).map(s => [s.symbol, s]));
    
    const response = {
      timezone: 'UTC',
      serverTime: Date.now(),
      symbols: (pairs as any[]).map(pair => {
        const market = symbolMap.get(pair.symbol);
        return {
          symbol: pair.symbol,
          baseAsset: pair.base_currency,
          quoteAsset: pair.quote_currency,
          status: pair.status,
          minPrice: pair.min_price || '0.00000001',
          maxPrice: pair.max_price || '100000000',
          tickSize: pair.tick_size || '0.00000001',
          minQuantity: pair.min_quantity || '0.00000001',
          maxQuantity: pair.max_quantity || '100000000',
          minNotional: pair.min_notional || '1',
          makerCommission: pair.maker_fee || 0.001,
          takerCommission: pair.taker_fee || 0.001,
          currentPrice: market?.price || 0,
        };
      }),
    };
    
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Exchange info API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
