import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Look up a red packet by its code (packet id)
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    const code = request.nextUrl.searchParams.get('code');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: code' },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${API_BASE_URL}/earn/red-packet/${encodeURIComponent(code)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error?.message || data.error || 'Red packet not found' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Red packet API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Create a red packet
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

    // The creator is always the authenticated session owner.
    const me = await fetch(new URL('/api/auth/me', request.nextUrl.origin), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meBody = await me.json().catch(() => null);
    if (!me.ok || !meBody?.user?.userId) {
      return NextResponse.json(
        { success: false, error: 'Could not resolve the current user' },
        { status: me.status === 200 ? 401 : me.status }
      );
    }

    const response = await fetch(`${API_BASE_URL}/earn/red-packet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, creator_id: meBody.user.userId }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error?.message || data.error || 'Failed to create red packet' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Create red packet API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
