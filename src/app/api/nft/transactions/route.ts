import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


// Get NFT transactions
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
    const tokenId = searchParams.get('tokenId');
    const limit = searchParams.get('limit') || '20';
    const page = searchParams.get('page') || '1';

    let url = `${API_BASE_URL}/nft/transactions?limit=${limit}&page=${page}`;
    if (contractAddress) url += `&contractAddress=${contractAddress}`;
    if (tokenId) url += `&tokenId=${tokenId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch NFT transactions' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('NFT transactions API error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
