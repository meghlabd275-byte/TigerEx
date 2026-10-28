import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function responseError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

async function forward(path: string, token: string, method = 'GET', body?: unknown) {
  if (!ADMIN_API_URL) {
    return responseError(
      'TIGEREX_ADMIN_API_URL is not configured; fee configuration is disabled.',
      503,
    );
  }
  try {
    const headers = new Headers({ Accept: 'application/json', Authorization: token });
    const init: RequestInit = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
    const upstream = await fetch(ADMIN_API_URL + path, init);
    const payload = await upstream
      .json()
      .catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: upstream.status });
  } catch {
    return responseError('Admin backend is unavailable; no fee state was changed.', 502);
  }
}

// List fee configurations from the durable admin backend.
export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return responseError('Authorization required', 401);

  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ['type', 'asset', 'network']) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return forward(`/admin/fees${suffix}`, token);
}

// Update a single fee configuration.
export async function PUT(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return responseError('Authorization required', 401);

  let body: { id?: string; updates?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return responseError('Invalid JSON body', 400);
  }

  const id = body.id?.trim();
  const updates = body.updates;
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    return responseError('A valid fee id is required', 400);
  }
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return responseError('A non-empty updates object is required', 400);
  }
  return forward(`/admin/fees/${encodeURIComponent(id)}`, token, 'PUT', { updates });
}
