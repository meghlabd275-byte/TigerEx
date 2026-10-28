import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API_URL = process.env.TIGEREX_ADMIN_API_URL?.replace(/\/$/, '');

function error(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  return header && /^Bearer\s+\S+$/i.test(header) ? header : null;
}

async function forward(path: string, token: string, method: string, body?: unknown) {
  if (!ADMIN_API_URL) {
    return error('TIGEREX_ADMIN_API_URL is not configured; banner management is disabled.', 503);
  }
  try {
    const headers = new Headers({ Accept: 'application/json', Authorization: token });
    const init: RequestInit = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${ADMIN_API_URL}${path}`, init);
    const payload = await response
      .json()
      .catch(() => ({ success: false, error: 'Invalid admin backend response' }));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return error('Admin backend is unavailable; no banner state was changed.', 502);
  }
}

export async function GET(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return error('Authorization required', 401);
  const { searchParams } = new URL(request.url);
  const placement = searchParams.get('placement');
  const suffix = placement ? `?placement=${encodeURIComponent(placement)}` : '';
  return forward(`/admin/banners${suffix}`, token, 'GET');
}

export async function POST(request: NextRequest) {
  const token = getBearer(request);
  if (!token) return error('Authorization required', 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }
  return forward('/admin/banners', token, 'POST', body);
}
