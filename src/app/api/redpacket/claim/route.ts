import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// Claim a red packet
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

    if (!body?.packetId) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameter: packetId' },
        { status: 400 }
      );
    }

    const { packetId, ...rest } = body;

    // The claimant is always the authenticated session owner.
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

    const response = await fetch(
      `${API_BASE_URL}/earn/red-packet/claim/${encodeURIComponent(packetId)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...rest, user_id: meBody.user.userId }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error?.message || data.error || 'Failed to claim red packet' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Claim red packet API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
