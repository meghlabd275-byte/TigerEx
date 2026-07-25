import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

/**
 * Grid Trading API - User endpoints
 * Handles grid trading strategy management
 */

// Get all grid strategies for user
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '20';
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    // Mock grid strategies data
    const strategies = [
      {
        id: 'grid_001',
        symbol: 'BTCUSDT',
        gridType: 'arithmetic',
        status: 'active',
        lowerPrice: '45000',
        upperPrice: '55000',
        gridCount: 20,
        investmentAmount: '10000',
        totalProfit: '250.50',
        totalTrades: 45,
        runningDays: 15,
        createdAt: Date.now() - 15 * 86400000
      },
      {
        id: 'grid_002',
        symbol: 'ETHUSDT',
        gridType: 'geometric',
        status: 'paused',
        lowerPrice: '2500',
        upperPrice: '4000',
        gridCount: 30,
        investmentAmount: '5000',
        totalProfit: '120.75',
        totalTrades: 28,
        runningDays: 10,
        createdAt: Date.now() - 10 * 86400000
      }
    ];

    let filtered = strategies;
    if (status && status !== 'all') {
      filtered = strategies.filter(s => s.status === status);
    }

    return NextResponse.json({
      success: true,
      data: filtered,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filtered.length
      }
    });
  } catch (error: any) {
    console.error('Grid list error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Create new grid strategy
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    
    const { symbol, gridType, lowerPrice, upperPrice, gridCount, investmentAmount, maxPositionSize, stopLoss, takeProfit, autoRebalance } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!symbol || !lowerPrice || !upperPrice || !investmentAmount) {
      return NextResponse.json(
        { success: false, error: 'Symbol, price range, and investment amount are required' },
        { status: 400 }
      );
    }

    // In production, this would create the grid strategy in the backend
    const strategyId = `grid_${Date.now()}`;
    
    return NextResponse.json({
      success: true,
      message: `Grid strategy created for ${symbol}`,
      strategy: {
        id: strategyId,
        symbol,
        gridType: gridType || 'arithmetic',
        status: 'pending',
        lowerPrice,
        upperPrice,
        gridCount: gridCount || 20,
        investmentAmount,
        maxPositionSize: maxPositionSize || 0,
        stopLoss: stopLoss || 0,
        takeProfit: takeProfit || 0,
        autoRebalance: autoRebalance || false,
        createdAt: Date.now()
      }
    });
  } catch (error: any) {
    console.error('Grid create error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Update grid strategy
export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    const { strategyId, action, updates } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!strategyId || !action) {
      return NextResponse.json(
        { success: false, error: 'Strategy ID and action are required' },
        { status: 400 }
      );
    }

    const validActions = ['start', 'stop', 'pause', 'resume', 'update'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action' },
        { status: 400 }
      );
    }

    // In production, this would update the grid strategy in the backend
    return NextResponse.json({
      success: true,
      message: `Grid strategy ${strategyId} ${action}ed successfully`,
      strategyId,
      action,
      updatedAt: Date.now()
    });
  } catch (error: any) {
    console.error('Grid update error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Delete grid strategy
export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const strategyId = searchParams.get('id');
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!strategyId) {
      return NextResponse.json(
        { success: false, error: 'Strategy ID is required' },
        { status: 400 }
      );
    }

    // In production, this would delete the grid strategy from the backend
    return NextResponse.json({
      success: true,
      message: `Grid strategy ${strategyId} deleted successfully`,
      deletedAt: Date.now()
    });
  } catch (error: any) {
    console.error('Grid delete error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
