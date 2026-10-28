import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

// Serve the banners and published announcements that visitors may see.
export async function GET(request: NextRequest) {
  if (!ADMIN_API_URL) {
    return NextResponse.json(
      { success: false, error: 'TIGEREX_ADMIN_API_URL is not configured; site content is unavailable.' },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const placement = searchParams.get('placement');
  const suffix = placement ? `?placement=${encodeURIComponent(placement)}` : '';

  try {
    const response = await fetch(`${ADMIN_API_URL}/admin/public/content${suffix}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response
      .json()
      .catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Admin backend is unavailable; site content could not be loaded.' },
      { status: 502 },
    );
  }
}
