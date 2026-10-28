import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// List withdrawal requests from the API service, which owns the ledger.
export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ['status', 'limit', 'offset']) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';

  try {
    const upstream = await fetch(`${API_BASE_URL}/admin/withdrawals${suffix}`, {
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
      { success: false, error: 'API service is unavailable; withdrawals could not be loaded.' },
      { status: 502 },
    );
  }
}
