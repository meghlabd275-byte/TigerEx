import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


function backendUrl(path: string): string | null {
  const base = backendBaseUrl();
  return base ? `${base}${path}` : null;
}

export async function POST(request: NextRequest) {
  const url = backendUrl('/order');
  const authorization = request.headers.get('authorization');
  const sessionId = request.headers.get('x-session-id');
  if (!url) return NextResponse.json({ success: false, error: { code: 'TRADING_BACKEND_UNAVAILABLE', message: 'A secure order backend is not configured.' } }, { status: 503 });
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization) || !sessionId) return NextResponse.json({ success: false, error: 'Authorization and session are required' }, { status: 401 });
  try {
    const body = await request.json();
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization, 'X-Session-ID': sessionId }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const data = await response.json().catch(() => ({ success: false, error: 'Invalid trading backend response' }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ success: false, error: { code: 'TRADING_BACKEND_UNAVAILABLE', message: 'Order service is unavailable.' } }, { status: 503 });
  }
}
