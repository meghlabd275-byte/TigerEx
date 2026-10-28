import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function error(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

// Read the system settings that the admin backend actually stores.
export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return error('Authorization required', 401);
  if (!ADMIN_API_URL) {
    return error('TIGEREX_ADMIN_API_URL is not configured; settings are unavailable.', 503);
  }

  try {
    const upstream = await fetch(`${ADMIN_API_URL}/admin/settings`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: token },
      cache: 'no-store',
    });
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return error('Admin backend is unavailable; settings could not be loaded.', 502);
  }
}

// Update one setting. The admin backend stores settings as key/value pairs.
export async function PUT(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return error('Authorization required', 401);

  let body: { key?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const key = typeof body.key === 'string' ? body.key : '';
  if (!/^[a-z0-9_]{1,64}$/.test(key)) return error('A valid setting key is required', 400);
  if (typeof body.value !== 'string') return error('Setting value must be a string', 400);

  if (!ADMIN_API_URL) {
    return error('TIGEREX_ADMIN_API_URL is not configured; settings are unavailable.', 503);
  }

  try {
    const upstream = await fetch(`${ADMIN_API_URL}/admin/settings`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ key, value: body.value }),
      cache: 'no-store',
    });
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return error('Admin backend is unavailable; the setting was not changed.', 502);
  }
}
