import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function responseError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// List the immutable admin audit trail from the durable admin backend.
export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return responseError('Authorization required', 401);

  if (!ADMIN_API_URL) {
    return responseError(
      'TIGEREX_ADMIN_API_URL is not configured; audit logs are disabled.',
      503,
    );
  }

  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ['admin_id', 'action', 'resource']) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';

  try {
    const upstream = await fetch(`${ADMIN_API_URL}/admin/audit-logs${suffix}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: token },
      cache: 'no-store',
    });
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return responseError('Admin backend is unavailable; audit logs could not be loaded.', 502);
  }
}
