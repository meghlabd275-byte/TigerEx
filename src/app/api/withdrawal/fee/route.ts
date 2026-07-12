import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get withdrawal fee
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const coin = searchParams.get('coin');
    const network = searchParams.get('network');

    if (!coin) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: coin' },
        { status: 400 }
      );
    }

    const url = network 
      ? `${API_BASE_URL}/withdrawal/fee?coin=${coin}&network=${network}`
      : `${API_BASE_URL}/withdrawal/fee?coin=${coin}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch withdrawal fee' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Withdrawal fee API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
