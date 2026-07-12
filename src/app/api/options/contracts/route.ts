import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get options contracts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const underlying = searchParams.get('underlying');
    const expiry = searchParams.get('expiry');
    const type = searchParams.get('type');

    const params = new URLSearchParams();
    if (underlying) params.append('underlying', underlying);
    if (expiry) params.append('expiry', expiry);
    if (type) params.append('type', type);

    const response = await fetch(`${API_BASE_URL}/options/contracts?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch options contracts' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Options contracts API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
