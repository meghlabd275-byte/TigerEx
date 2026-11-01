import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// Approve or reject one withdrawal through the API service.
export async function POST(
  request: NextRequest,
  { params }: { params: { withdrawalId: string; action: string } },
) {
  const API_BASE_URL = backendBaseUrl();
  if (!API_BASE_URL) {
    return NextResponse.json(
      { success: false, error: { code: 'BACKEND_UNAVAILABLE', message: 'The trading backend is not configured.' } },
      { status: 503 },
    );
  }
  const token = getBearer(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }

  const { withdrawalId, action } = params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(withdrawalId)) {
    return NextResponse.json({ success: false, error: 'Invalid withdrawal id' }, { status: 400 });
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  }

  let body: unknown = undefined;
  if (action === 'reject') {
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'A rejection reason is required' }, { status: 400 });
    }
  }

  try {
    const upstream = await fetch(
      `${API_BASE_URL}/admin/withdrawals/${encodeURIComponent(withdrawalId)}/${action}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      },
    );
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid API response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'API service is unavailable; no withdrawal state was changed.' },
      { status: 502 },
    );
  }
}
