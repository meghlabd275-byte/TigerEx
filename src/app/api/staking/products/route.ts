import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get staking products
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const asset = searchParams.get('asset');

    let url = `${API_BASE_URL}/staking/products`;
    if (asset) url += `?asset=${asset}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch staking products' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Staking products API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
