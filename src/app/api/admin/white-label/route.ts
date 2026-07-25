import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

/**
 * White Label Management API - Admin endpoints
 * Handles white label client creation, management, and configuration
 */

// Get all white label clients
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

    // Mock white label data
    const whiteLabels = [
      {
        id: 'wl_001',
        name: 'CryptoTrade Pro',
        domain: 'cryptotradepro.com',
        status: 'active',
        plan: 'enterprise',
        createdAt: Date.now() - 60 * 86400000,
        features: {
          spot: true,
          futures: true,
          margin: true,
          p2p: true,
          staking: true,
          nft: false
        },
        branding: {
          primaryColor: '#1E88E5',
          secondaryColor: '#FF6D00',
          logo: 'https://example.com/logo.png'
        },
        users: 15000,
        volume24h: 50000000
      },
      {
        id: 'wl_002',
        name: 'SecureExchange',
        domain: 'securex.io',
        status: 'active',
        plan: 'business',
        createdAt: Date.now() - 30 * 86400000,
        features: {
          spot: true,
          futures: false,
          margin: false,
          p2p: true,
          staking: true,
          nft: false
        },
        branding: {
          primaryColor: '#10B981',
          secondaryColor: '#3B82F6',
          logo: 'https://example.com/logo2.png'
        },
        users: 5000,
        volume24h: 10000000
      },
      {
        id: 'wl_003',
        name: 'TradeHub',
        domain: 'tradehub.exchange',
        status: 'pending',
        plan: 'starter',
        createdAt: Date.now() - 86400000,
        features: {
          spot: true,
          futures: false,
          margin: false,
          p2p: false,
          staking: false,
          nft: false
        },
        branding: {
          primaryColor: '#8B5CF6',
          secondaryColor: '#EC4899',
          logo: 'https://example.com/logo3.png'
        },
        users: 0,
        volume24h: 0
      }
    ];

    let filtered = whiteLabels;
    if (status && status !== 'all') {
      filtered = whiteLabels.filter(wl => wl.status === status);
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
    console.error('White label list error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Create new white label client
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    const { name, domain, plan, features, branding } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!name || !domain || !plan) {
      return NextResponse.json(
        { success: false, error: 'Name, domain, and plan are required' },
        { status: 400 }
      );
    }

    // In production, this would create the white label in the backend
    const whiteLabelId = `wl_${Date.now()}`;
    
    return NextResponse.json({
      success: true,
      message: `White label ${name} created successfully`,
      whiteLabel: {
        id: whiteLabelId,
        name,
        domain,
        plan,
        status: 'pending',
        features: features || { spot: true },
        branding: branding || {},
        createdAt: Date.now()
      }
    });
  } catch (error: any) {
    console.error('White label create error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Update white label
export async function PUT(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();
    const { whiteLabelId, updates } = body;
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!whiteLabelId || !updates) {
      return NextResponse.json(
        { success: false, error: 'White label ID and updates are required' },
        { status: 400 }
      );
    }

    // In production, this would update the white label in the backend
    return NextResponse.json({
      success: true,
      message: `White label ${whiteLabelId} updated successfully`,
      updatedAt: Date.now()
    });
  } catch (error: any) {
    console.error('White label update error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Delete white label
export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const whiteLabelId = searchParams.get('id');
    
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!whiteLabelId) {
      return NextResponse.json(
        { success: false, error: 'White label ID is required' },
        { status: 400 }
      );
    }

    // In production, this would delete the white label from the backend
    return NextResponse.json({
      success: true,
      message: `White label ${whiteLabelId} deleted successfully`,
      deletedAt: Date.now()
    });
  } catch (error: any) {
    console.error('White label delete error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
