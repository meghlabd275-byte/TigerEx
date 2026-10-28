import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// Revoke a single API key through the API service.
export async function PUT(
  request: NextRequest,
  { params }: { params: { keyId: string } },
) {
  const token = getBearer(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }

  const keyId = params.keyId;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(keyId)) {
    return NextResponse.json({ success: false, error: 'Invalid key id' }, { status: 400 });
  }

  try {
    const upstream = await fetch(
      `${API_BASE_URL}/admin/api-keys/${encodeURIComponent(keyId)}/revoke`,
      {
        method: 'PUT',
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
      { success: false, error: 'API service is unavailable; the key was not revoked.' },
      { status: 502 },
    );
  }
}
