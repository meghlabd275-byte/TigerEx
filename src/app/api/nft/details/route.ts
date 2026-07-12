import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get NFT details
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tokenId = searchParams.get('tokenId');
    const contractAddress = searchParams.get('contractAddress');

    if (!tokenId || !contractAddress) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: tokenId, contractAddress' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/nft/details?tokenId=${tokenId}&contractAddress=${contractAddress}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch NFT details' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('NFT details API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
