import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Convert assets
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

    const { fromCoin, toCoin, amount } = body;

    if (!fromCoin || !toCoin || !amount) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: fromCoin, toCoin, amount' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/wallet/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        fromCoin,
        toCoin,
        amount,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Conversion failed' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Wallet convert API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
