import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function unavailable() {
  return NextResponse.json(
    { success: false, error: 'TIGEREX_ADMIN_API_URL is not configured; withdrawal operations are disabled.' },
    { status: 503 },
  );
}

function authHeader(request: NextRequest): string | null {
  const value = request.headers.get('authorization');
  if (!value || !/^Bearer\s+\S+$/i.test(value)) return null;
  return value;
}

async function backendRequest(path: string, token: string, init: RequestInit = {}) {
  if (!ADMIN_API_URL) return unavailable();
  try {
    const response = await fetch(\`\${ADMIN_API_URL}\${path}\`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: token,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({ success: false, error: 'Invalid backend response' }));
    return NextResponse.json(body, { status: response.status });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Admin backend is unavailable; no withdrawal state was changed.' },
      { status: 502 },
    );
  }
}

// Proxy live withdrawal records to the authenticated durable admin backend.
export async function GET(request: NextRequest) {
  const token = authHeader(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ['status', 'currency']) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.size ? \`?\${query.toString()}\` : '';
  return backendRequest(\`/admin/withdrawals\${suffix}\`, token);
}

// Process a single withdrawal only through the backend's persisted state transition.
export async function PUT(request: NextRequest) {
  const token = authHeader(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }

  let body: { withdrawalId?: string; action?: string; reason?: string; txHash?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const withdrawalId = body.withdrawalId?.trim();
  if (!withdrawalId || !/^[a-zA-Z0-9_-]{1,128}$/.test(withdrawalId)) {
    return NextResponse.json({ success: false, error: 'A valid withdrawalId is required' }, { status: 400 });
  }
  if (!body.action || !['approve', 'reject', 'process'].includes(body.action)) {
    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  }
  return backendRequest(\`/admin/withdrawals/\${encodeURIComponent(withdrawalId)}\`, token, {
    method: 'PUT',
    body: JSON.stringify({ action: body.action, txHash: body.txHash }),
  });
}

// Bulk operations are deliberately disabled until the backend offers an atomic bulk endpoint.
export async function POST(request: NextRequest) {
  const token = authHeader(request);
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }
  if (!ADMIN_API_URL) return unavailable();
  return NextResponse.json(
    { success: false, error: 'Bulk withdrawal processing is not supported by the backend; use the single-withdrawal endpoint.' },
    { status: 501 },
  );
}
