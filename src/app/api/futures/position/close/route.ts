import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';

/**
 * Close a futures position.
 *
 * Closing a position is a risk-reducing trade that must settle in the matching
 * engine and the ledger. Until a durable futures execution backend is
 * configured this returns 503 rather than reporting a close that did not
 * happen, which would leave the caller believing a live position was flat.
 */
export async function POST(request: NextRequest) {
  const API_BASE_URL = backendBaseUrl();
  if (!API_BASE_URL) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'FUTURES_EXECUTION_UNAVAILABLE',
          message: 'Position close requires a durable futures execution backend, which is not configured.',
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
    );
  }

  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const upstream = await fetch(`${API_BASE_URL}/futures/position/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const data = await upstream.json().catch(() => ({
      success: false,
      error: 'Invalid futures backend response',
    }));
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'FUTURES_EXECUTION_UNAVAILABLE', message: 'Futures service is unavailable.' },
      },
      { status: 503 },
    );
  }
}
