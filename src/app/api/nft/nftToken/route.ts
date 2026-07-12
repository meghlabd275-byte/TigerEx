import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get NFT token info
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contractAddress = searchParams.get('contractAddress');
    const tokenId = searchParams.get('tokenId');

    if (!contractAddress || !tokenId) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: contractAddress, tokenId' },
        { status: 400 }
      );
    }

    const url = `${API_BASE_URL}/nft/nftToken?contractAddress=${contractAddress}&tokenId=${tokenId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch NFT token info' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('NFT token API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
