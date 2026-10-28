import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// Update a market's trading status through the API service.
export async function PUT(
  request: NextRequest,
  { params }: { params: { symbol: string } },
) {
  const token = getBearer(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }

  const symbol = params.symbol;
  if (!/^[A-Za-z0-9_\-/]{1,32}$/.test(symbol)) {
    return NextResponse.json({ success: false, error: 'Invalid market symbol' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const upstream = await fetch(
      `${API_BASE_URL}/admin/markets/${encodeURIComponent(symbol)}`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: token,
        },
        body: JSON.stringify(body),
        cache: 'no-store',
      },
    );
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid API response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'API service is unavailable; the market was not changed.' },
      { status: 502 },
    );
  }
}
