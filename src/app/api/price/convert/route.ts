import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Convert price
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const amount = searchParams.get('amount');

    if (!from || !to || !amount) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: from, to, amount' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/price/convert?from=${from}&to=${to}&amount=${amount}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to convert price' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Price convert API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
