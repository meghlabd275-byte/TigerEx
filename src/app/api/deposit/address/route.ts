import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get deposit address
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const coin = searchParams.get('coin');
    const network = searchParams.get('network');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!coin) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: coin' },
        { status: 400 }
      );
    }

    const url = network 
      ? `${API_BASE_URL}/deposit/address?coin=${coin}&network=${network}`
      : `${API_BASE_URL}/deposit/address?coin=${coin}`;

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
        { success: false, error: data.error || 'Failed to fetch deposit address' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Deposit address API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
