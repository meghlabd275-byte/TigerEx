import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Change margin type
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

    const { symbol, marginType } = body;

    if (!symbol || !marginType) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: symbol, marginType' },
        { status: 400 }
      );
    }

    if (!['ISOLATED', 'CROSSED'].includes(marginType.toUpperCase())) {
      return NextResponse.json(
        { success: false, error: 'Invalid marginType. Must be ISOLATED or CROSSED' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/futures/position/changeMarginType`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        symbol,
        marginType: marginType.toUpperCase(),
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to change margin type' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Change margin type API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
