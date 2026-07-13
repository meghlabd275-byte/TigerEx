import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Validate blockchain address
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, network } = body;

    if (!address || !network) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: address, network' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/address/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ address, network }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to validate address' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Address validate API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
