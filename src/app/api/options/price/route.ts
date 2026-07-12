import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get options price
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const underlying = searchParams.get('underlying');
    const expirationDate = searchParams.get('expirationDate');
    const strikePrice = searchParams.get('strikePrice');
    const optionSide = searchParams.get('optionSide');
    const period = searchParams.get('period');

    if (!underlying) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: underlying' },
        { status: 400 }
      );
    }

    let url = `${API_BASE_URL}/options/price?underlying=${underlying}`;
    if (expirationDate) url += `&expirationDate=${expirationDate}`;
    if (strikePrice) url += `&strikePrice=${strikePrice}`;
    if (optionSide) url += `&optionSide=${optionSide}`;
    if (period) url += `&period=${period}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch options price' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Options price API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
