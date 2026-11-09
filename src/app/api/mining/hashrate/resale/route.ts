import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


// Get mining hashrate resale list
export async function GET(request: NextRequest) {
  const API_BASE_URL = backendBaseUrl();
  if (!API_BASE_URL) {
    return NextResponse.json(
      { success: false, error: { code: 'BACKEND_UNAVAILABLE', message: 'The trading backend is not configured.' } },
      { status: 503 },
    );
  }
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const algo = searchParams.get('algo');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const pageIndex = searchParams.get('pageIndex') || '1';
    const pageSize = searchParams.get('pageSize') || '20';

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    let url = `${API_BASE_URL}/mining/hashrate/resale?pageIndex=${pageIndex}&pageSize=${pageSize}`;
    if (algo) url += `&algo=${algo}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;

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
        { success: false, error: data.error || 'Failed to fetch hashrate resale list' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Hashrate resale API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
