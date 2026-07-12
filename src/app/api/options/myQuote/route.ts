import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get options my quote
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const underlying = searchParams.get('underlying');
    const expirationDate = searchParams.get('expirationDate');
    const strikePrice = searchParams.get('strikePrice');
    const optionSide = searchParams.get('optionSide');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!underlying || !expirationDate || !strikePrice || !optionSide) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: underlying, expirationDate, strikePrice, optionSide' },
        { status: 400 }
      );
    }

    const url = `${API_BASE_URL}/options/myQuote?underlying=${underlying}&expirationDate=${expirationDate}&strikePrice=${strikePrice}&optionSide=${optionSide}`;

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
        { success: false, error: data.error || 'Failed to fetch my quote' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('My quote API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
