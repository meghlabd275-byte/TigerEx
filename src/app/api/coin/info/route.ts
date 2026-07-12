import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get coin info
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const coin = searchParams.get('coin');

    if (!coin) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: coin' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/coin/info?coin=${coin}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch coin info' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Coin info API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
