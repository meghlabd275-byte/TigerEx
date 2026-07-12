import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get all markets/trading pairs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const quote = searchParams.get('quote'); // e.g., USDT, BTC
    const base = searchParams.get('base');
    const limit = searchParams.get('limit') || '100';

    let url = `${API_BASE_URL}/markets?limit=${limit}`;
    if (quote) url += `&quote=${quote}`;
    if (base) url += `&base=${base}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch markets' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Markets API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
