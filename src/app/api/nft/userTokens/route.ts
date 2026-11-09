import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


// Get user's NFT tokens
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
    const contractAddress = searchParams.get('contractAddress');
    const limit = searchParams.get('limit') || '20';
    const page = searchParams.get('page') || '1';

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    let url = `${API_BASE_URL}/nft/userTokens?limit=${limit}&page=${page}`;
    if (contractAddress) url += `&contractAddress=${contractAddress}`;

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
        { success: false, error: data.error || 'Failed to fetch user NFT tokens' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('NFT user tokens API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
