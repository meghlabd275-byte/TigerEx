import { NextRequest, NextResponse } from 'next/server';

const EARN_API_URL = process.env.TIGEREX_EARN_API_URL?.replace(/\/$/, '');

// Stake into a launchpool through the earn service.
export async function POST(request: NextRequest) {
  if (!EARN_API_URL) {
    return NextResponse.json(
      { success: false, error: 'TIGEREX_EARN_API_URL is not configured; airdrop staking is unavailable.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${EARN_API_URL}/api/v1/earn/launchpool/stake`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid earn service response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Earn service is unavailable; the stake was not recorded.' },
      { status: 502 },
    );
  }
}
