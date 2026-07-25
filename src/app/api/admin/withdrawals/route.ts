import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

/**
 * Withdrawal Management API - Admin endpoints
 * Handles withdrawal requests approval, rejection, and processing
 */

// Get all withdrawal requests
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

    // Mock withdrawal data
    const withdrawals = [
      {
        id: 'withdraw_001',
        userId: 'user_001',
        email: 'user@example.com',
        currency: 'BTC',
        amount: 0.5,
        fee: 0.0005,
        netAmount: 0.4995,
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f4e2E1',
        network: 'Bitcoin',
        status: 'pending',
        createdAt: Date.now() - 3600000,
        kycLevel: 2
      },
      {
        id: 'withdraw_002',
        userId: 'user_002',
        email: 'user2@example.com',
        currency: 'ETH',
        amount: 2.5,
        fee: 0.005,
        netAmount: 2.495,
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f4e2E1',
        network: 'Ethereum',
        status: 'approved',
        approvedAt: Date.now() - 1800000,
        approvedBy: 'admin@tigerex.com',
        createdAt: Date.now() - 7200000,
        kycLevel: 2
      },
      {
        id: 'withdraw_003',
        userId: 'user_003',
        email: 'user3@example.com',
        currency: 'USDT',
        amount: 5000,
        fee: 1,
        netAmount: 4999,
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f4e2E1',
        network: 'Tron',
        status: 'processing',
        createdAt: Date.now() - 10800000,
        kycLevel: 2
      }
    ];

    let filtered = withdrawals;
    if (status && status !== 'all') {
      filtered = withdrawals.filter(w => w.status === status);
    }

    return NextResponse.json({
      success: true,
      data: filtered,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filtered.length
      },
      stats: {
        pending: withdrawals.filter(w => w.status === 'pending').length,
        processing: withdrawals.filter(w => w.status === 'processing').length,
        approved: withdrawals.filter(w => w.status === 'approved').length,
        rejected: withdrawals.filter(w => w.status === 'rejected').length
      }
    });
  } catch (error: any) {
    console.error('Withdrawals list error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Process withdrawal (approve/reject)
export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    const { withdrawalId, action, reason } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!withdrawalId || !action) {
      return NextResponse.json(
        { success: false, error: 'Withdrawal ID and action are required' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject', 'process'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action' },
        { status: 400 }
      );
    }

    // In production, this would process the withdrawal in the backend
    const status = action === 'reject' ? 'rejected' : action === 'approve' ? 'approved' : 'processing';
    
    return NextResponse.json({
      success: true,
      message: `Withdrawal ${withdrawalId} ${status}`,
      withdrawalId,
      status,
      processedAt: Date.now()
    });
  } catch (error: any) {
    console.error('Withdrawal process error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Bulk process withdrawals
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    const { withdrawalIds, action, reason } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!withdrawalIds || !Array.isArray(withdrawalIds) || withdrawalIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Withdrawal IDs array is required' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action' },
        { status: 400 }
      );
    }

    // In production, this would bulk process withdrawals
    return NextResponse.json({
      success: true,
      message: `${withdrawalIds.length} withdrawals ${action}d`,
      processedCount: withdrawalIds.length,
      processedAt: Date.now()
    });
  } catch (error: any) {
    console.error('Withdrawal bulk process error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
