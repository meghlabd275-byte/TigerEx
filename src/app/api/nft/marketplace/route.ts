import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


// Get NFT marketplace listings
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
    const collection = searchParams.get('collection');
    const status = searchParams.get('status');
    const limit = searchParams.get('limit') || '20';
    const offset = searchParams.get('offset') || '0';

    const params = new URLSearchParams();
    params.append('limit', limit);
    params.append('offset', offset);
    if (collection) params.append('collection', collection);
    if (status) params.append('status', status);

    const response = await fetch(`${API_BASE_URL}/nft/marketplace?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch NFT marketplace' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('NFT marketplace API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
