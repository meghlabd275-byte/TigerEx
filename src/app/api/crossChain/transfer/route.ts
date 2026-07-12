import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Cross-chain transfer
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const body = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    const { fromChain, toChain, token: tokenSymbol, amount, toAddress } = body;

    if (!fromChain || !toChain || !tokenSymbol || !amount || !toAddress) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: fromChain, toChain, token, amount, toAddress' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/crossChain/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        fromChain,
        toChain,
        token: tokenSymbol,
        amount,
        toAddress,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to initiate cross-chain transfer' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Cross-chain transfer API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Get cross-chain transfer status
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const transferId = searchParams.get('transferId');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!transferId) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: transferId' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/crossChain/transfer?transferId=${transferId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to get transfer status' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Cross-chain transfer API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
