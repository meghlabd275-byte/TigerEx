import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get convert quote
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const fromAsset = searchParams.get('fromAsset');
    const toAsset = searchParams.get('toAsset');
    const amount = searchParams.get('amount');

    if (!fromAsset || !toAsset || !amount) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: fromAsset, toAsset, amount' },
        { status: 400 }
      );
    }

    let url = `${API_BASE_URL}/convert/quote?fromAsset=${fromAsset}&toAsset=${toAsset}&amount=${amount}`;
    if (token) {
      url += `&token=${token}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch convert quote' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Convert quote API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
