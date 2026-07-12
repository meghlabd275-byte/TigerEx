import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get fiat quotes
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fiatUuid = searchParams.get('fiatUuid');
    const amount = searchParams.get('amount');
    const currency = searchParams.get('currency');

    if (!fiatUuid || !amount || !currency) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: fiatUuid, amount, currency' },
        { status: 400 }
      );
    }

    const url = `${API_BASE_URL}/fiat/quotes?fiatUuid=${fiatUuid}&amount=${amount}&currency=${currency}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch fiat quotes' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Fiat quotes API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
