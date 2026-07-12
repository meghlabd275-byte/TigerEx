import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Place order (spot trading)
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

    const { symbol, side, type, quantity, price, stopPrice, timeInForce } = body;

    if (!symbol || !side || !type || !quantity) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: symbol, side, type, quantity' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/order/place`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        symbol,
        side,
        type,
        quantity,
        price,
        stopPrice,
        timeInForce: timeInForce || 'GTC',
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to place order' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Place order API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
