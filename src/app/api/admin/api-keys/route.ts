import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// List registered API keys. Secret material is never returned by the API.
export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit') ?? '100';
  const offset = searchParams.get('offset') ?? '0';

  try {
    const upstream = await fetch(
      `${API_BASE_URL}/admin/api-keys?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: token },
        cache: 'no-store',
      },
    );
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid API response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'API service is unavailable; API keys could not be loaded.' },
      { status: 502 },
    );
  }
}
