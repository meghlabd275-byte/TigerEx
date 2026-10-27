import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

// List the current user's coupons
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Authorization required' },
        { status: 401 }
      );
    }

    // Resolve the caller identity from the session rather than trusting a
    // client-supplied user id.
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
    const userId = meBody.user.userId as string;

    const response = await fetch(
      `${API_BASE_URL}/earn/users/${encodeURIComponent(userId)}/coupons`,
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
        { success: false, error: data.error?.message || data.error || 'Failed to fetch coupons' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Coupons API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// Redeem a coupon code
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

    // The redeem target is always the authenticated session owner, so a caller
    // cannot redeem a code against another account.
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

    const response = await fetch(`${API_BASE_URL}/earn/coupons/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user_id: meBody.user.userId, code: body?.code }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: data.error?.message || data.error || 'Failed to redeem coupon' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Redeem coupon API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
