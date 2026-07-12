import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get P2P orders
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const adId = searchParams.get('adId');
    const orderId = searchParams.get('orderId');
    const tradeType = searchParams.get('tradeType');
    const fiat = searchParams.get('fiat');
    const paymentMethod = searchParams.get('paymentMethod');
    const crypto = searchParams.get('crypto');
    const status = searchParams.get('status');
    const page = searchParams.get('page') || '1';
    const rows = searchParams.get('rows') || '20';

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    let url = `${API_BASE_URL}/p2p/orders?page=${page}&rows=${rows}`;
    if (adId) url += `&adId=${adId}`;
    if (orderId) url += `&orderId=${orderId}`;
    if (tradeType) url += `&tradeType=${tradeType}`;
    if (fiat) url += `&fiat=${fiat}`;
    if (paymentMethod) url += `&paymentMethod=${paymentMethod}`;
    if (crypto) url += `&crypto=${crypto}`;
    if (status) url += `&status=${status}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch P2P orders' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('P2P orders API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Create P2P order
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    const { adId, amount } = body;

    if (!adId || !amount) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: adId, amount' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/p2p/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        adId,
        amount,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to create P2P order' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('P2P orders API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
