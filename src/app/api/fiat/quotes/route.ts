import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


// Get fiat quotes
export async function GET(request: NextRequest) {
  const API_BASE_URL = backendBaseUrl();
  if (!API_BASE_URL) {
    return NextResponse.json(
      { success: false, error: { code: 'BACKEND_UNAVAILABLE', message: 'The trading backend is not configured.' } },
      { status: 503 },
    );
  }
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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
