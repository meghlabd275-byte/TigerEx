import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * Get 24hr Ticker - Production Implementation
 * Returns 24hr price change statistics from database
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    
    const db = getDb();
    
    if (symbol) {
      // Return specific symbol
      const ticker = db.prepare(`
        SELECT * FROM market_data WHERE symbol = ?
      `).get(symbol.toUpperCase());
      
      if (!ticker) {
        return NextResponse.json(
          { success: false, error: 'Symbol not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        symbol: (ticker as any).symbol,
        price: (ticker as any).price,
        priceChange: (ticker as any).change_24h,
        priceChangePercent: (ticker as any).change_percent_24h,
        highPrice: (ticker as any).high_24h,
        lowPrice: (ticker as any).low_24h,
        volume: (ticker as any).volume_24h,
        quoteVolume: (ticker as any).volume_24h * (ticker as any).price,
      });
    }
    
    // Return all tickers
    const tickers = db.prepare(`
      SELECT * FROM market_data ORDER BY symbol
    `).all();
    
    return NextResponse.json({
      success: true,
      data: tickers.map((ticker: any) => ({
        symbol: ticker.symbol,
        price: ticker.price,
        priceChange: ticker.change_24h,
        priceChangePercent: ticker.change_percent_24h,
        highPrice: ticker.high_24h,
        lowPrice: ticker.low_24h,
        volume: ticker.volume_24h,
        quoteVolume: ticker.volume_24h * ticker.price,
      })),
    });
  } catch (error: any) {
    console.error('24hr ticker API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
