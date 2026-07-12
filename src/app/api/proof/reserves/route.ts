import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Get proof of reserves
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeMerkleTree = searchParams.get('includeMerkleTree') || 'false';

    const response = await fetch(`${API_BASE_URL}/proof/reserves?includeMerkleTree=${includeMerkleTree}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch proof of reserves' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Proof of reserves API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
