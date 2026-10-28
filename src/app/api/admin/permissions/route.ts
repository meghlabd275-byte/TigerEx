import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function responseError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// Read the authoritative role/permission catalogue from the admin backend.
export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return responseError('Authorization required', 401);

  if (!ADMIN_API_URL) {
    return responseError(
      'TIGEREX_ADMIN_API_URL is not configured; permission data is disabled.',
      503,
    );
  }

  try {
    const upstream = await fetch(`${ADMIN_API_URL}/admin/permissions`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: token },
      cache: 'no-store',
    });
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return responseError('Admin backend is unavailable; permission data could not be loaded.', 502);
  }
}
