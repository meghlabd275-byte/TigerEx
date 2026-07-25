import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

/**
 * Trading Pairs Management API - Admin endpoints
 * Handles trading pair creation, updates, and management
 */

// Get all trading pairs
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '50';
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    // Mock trading pairs data
    const pairs = [
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        status: 'trading',
        pricePrecision: 2,
        quantityPrecision: 6,
        minPrice: '0.01',
        maxPrice: '1000000',
        minQuantity: '0.000001',
        maxQuantity: '100',
        makerFee: 0.001,
        takerFee: 0.001,
        isTrending: true,
        volume24h: 12500.5,
        createdAt: Date.now() - 30 * 86400000
      },
      {
        symbol: 'ETHUSDT',
        baseAsset: 'ETH',
        quoteAsset: 'USDT',
        status: 'trading',
        pricePrecision: 2,
        quantityPrecision: 5,
        minPrice: '0.01',
        maxPrice: '100000',
        minQuantity: '0.00001',
        maxQuantity: '10000',
        makerFee: 0.001,
        takerFee: 0.001,
        isTrending: true,
        volume24h: 45000.0,
        createdAt: Date.now() - 30 * 86400000
      },
      {
        symbol: 'BNBUSDT',
        baseAsset: 'BNB',
        quoteAsset: 'USDT',
        status: 'trading',
        pricePrecision: 2,
        quantityPrecision: 4,
        minPrice: '0.01',
        maxPrice: '10000',
        minQuantity: '0.0001',
        maxQuantity: '100000',
        makerFee: 0.001,
        takerFee: 0.001,
        isTrending: false,
        volume24h: 15000.0,
        createdAt: Date.now() - 30 * 86400000
      },
      {
        symbol: 'SOLUSDT',
        baseAsset: 'SOL',
        quoteAsset: 'USDT',
        status: 'trading',
        pricePrecision: 3,
        quantityPrecision: 3,
        minPrice: '0.001',
        maxPrice: '1000',
        minQuantity: '0.01',
        maxQuantity: '100000',
        makerFee: 0.001,
        takerFee: 0.001,
        isTrending: true,
        volume24h: 25000.0,
        createdAt: Date.now() - 15 * 86400000
      },
      {
        symbol: 'XRPUSDT',
        baseAsset: 'XRP',
        quoteAsset: 'USDT',
        status: 'trading',
        pricePrecision: 5,
        quantityPrecision: 1,
        minPrice: '0.0001',
        maxPrice: '100',
        minQuantity: '1',
        maxQuantity: '10000000',
        makerFee: 0.001,
        takerFee: 0.001,
        isTrending: false,
        volume24h: 50000.0,
        createdAt: Date.now() - 30 * 86400000
      }
    ];

    return NextResponse.json({
      success: true,
      data: pairs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: pairs.length
      }
    });
  } catch (error: any) {
    console.error('Pairs list error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Create new trading pair
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    const { symbol, baseAsset, quoteAsset, pricePrecision, quantityPrecision, status } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!symbol || !baseAsset || !quoteAsset) {
      return NextResponse.json(
        { success: false, error: 'Symbol, base asset, and quote asset are required' },
        { status: 400 }
      );
    }

    // In production, this would create the pair in the backend
    return NextResponse.json({
      success: true,
      message: `Trading pair ${symbol} created successfully`,
      pair: {
        symbol,
        baseAsset,
        quoteAsset,
        status: status || 'trading',
        pricePrecision: pricePrecision || 2,
        quantityPrecision: quantityPrecision || 4,
        createdAt: Date.now()
      }
    });
  } catch (error: any) {
    console.error('Pair create error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Update trading pair
export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    const { symbol, updates } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!symbol || !updates) {
      return NextResponse.json(
        { success: false, error: 'Symbol and updates are required' },
        { status: 400 }
      );
    }

    // In production, this would update the pair in the backend
    return NextResponse.json({
      success: true,
      message: `Trading pair ${symbol} updated successfully`,
      updatedAt: Date.now()
    });
  } catch (error: any) {
    console.error('Pair update error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Delete trading pair
export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol is required' },
        { status: 400 }
      );
    }

    // In production, this would delete the pair from the backend
    return NextResponse.json({
      success: true,
      message: `Trading pair ${symbol} deleted successfully`,
      deletedAt: Date.now()
    });
  } catch (error: any) {
    console.error('Pair delete error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
