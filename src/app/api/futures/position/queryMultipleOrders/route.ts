import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Query multiple orders
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const orderIdList = searchParams.get('orderIdList');
    const origClientOrderIdList = searchParams.get('origClientOrderIdList');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!orderIdList && !origClientOrderIdList) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: orderIdList or origClientOrderIdList' },
        { status: 400 }
      );
    }

    let url = `${API_BASE_URL}/futures/position/queryMultipleOrders?`;
    if (orderIdList) url += `orderIdList=${orderIdList}`;
    if (origClientOrderIdList) url += `origClientOrderIdList=${origClientOrderIdList}`;

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
        { success: false, error: data.error || 'Failed to query multiple orders' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Query multiple orders API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
