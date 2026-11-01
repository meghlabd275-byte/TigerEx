import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


// List the red packets created by the current user
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

    const response = await fetch(
      `${API_BASE_URL}/earn/users/${encodeURIComponent(meBody.user.userId)}/red-packets`,
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
        { success: false, error: data.error?.message || data.error || 'Failed to fetch red packets' },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Red packet list API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
