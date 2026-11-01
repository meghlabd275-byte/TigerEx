import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


// Get options price
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
