import { NextRequest, NextResponse } from 'next/server';

const EARN_API_URL = process.env.TIGEREX_EARN_API_URL?.replace(/\/$/, '');

// List a user's launchpool stakes from the earn service.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId || !/^[A-Za-z0-9_-]{1,64}$/.test(userId)) {
    return NextResponse.json({ success: false, error: 'A valid userId is required' }, { status: 400 });
  }
  if (!EARN_API_URL) {
    return NextResponse.json(
      { success: false, error: 'TIGEREX_EARN_API_URL is not configured; airdrop history is unavailable.' },
      { status: 503 },
    );
  }

  try {
    const upstream = await fetch(
      `${EARN_API_URL}/api/v1/earn/users/${encodeURIComponent(userId)}/launchpool-stakes`,
      { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' },
    );
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid earn service response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Earn service is unavailable; airdrop history could not be loaded.' },
      { status: 502 },
    );
  }
}
