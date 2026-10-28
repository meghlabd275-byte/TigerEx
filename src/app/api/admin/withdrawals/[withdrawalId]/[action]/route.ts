import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// Approve or reject one withdrawal through the API service.
export async function POST(
  request: NextRequest,
  { params }: { params: { withdrawalId: string; action: string } },
) {
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
