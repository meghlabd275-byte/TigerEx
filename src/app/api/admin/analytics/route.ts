import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// Daily volume, user growth and revenue series aggregated from the exchange ledger.
export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }

  const rawDays = request.nextUrl.searchParams.get('days') ?? '30';
  const days = Number.parseInt(rawDays, 10);
  if (!Number.isFinite(days) || days < 1 || days > 366) {
    return NextResponse.json(
      { success: false, error: 'days must be an integer between 1 and 366' },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(`${API_BASE_URL}/admin/analytics?days=${days}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: token },
      cache: 'no-store',
    });
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid API response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'API service is unavailable; analytics could not be loaded.' },
      { status: 502 },
    );
  }
}
