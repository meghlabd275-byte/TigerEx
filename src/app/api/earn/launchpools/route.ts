import { NextRequest, NextResponse } from 'next/server';

const EARN_API_URL = process.env.TIGEREX_EARN_API_URL?.replace(/\/$/, '');

// List live launchpool projects from the earn service. The earn service owns
// launchpool state; when it is not deployed the endpoint reports unavailable
// rather than showing an empty campaign list.
export async function GET(request: NextRequest) {
  if (!EARN_API_URL) {
    return NextResponse.json(
      {
        success: false,
        error: 'TIGEREX_EARN_API_URL is not configured; launchpool campaigns are unavailable.',
      },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';

  try {
    const upstream = await fetch(`${EARN_API_URL}/api/v1/earn/launchpools${suffix}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid earn service response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Earn service is unavailable; launchpool campaigns could not be loaded.' },
      { status: 502 },
    );
  }
}
