import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8080/api/v1');

export async function POST(request: NextRequest) {
  if (!API_BASE_URL || (process.env.NODE_ENV === 'production' && !API_BASE_URL.startsWith('https://'))) return NextResponse.json({ success: false, error: { code: 'KYC_BACKEND_UNAVAILABLE', message: 'A secure KYC backend is not configured.' } }, { status: 503 });
  const authorization = request.headers.get('authorization');
  const sessionId = request.headers.get('x-session-id');
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization) || !sessionId) return NextResponse.json({ success: false, error: 'Authorization and session are required' }, { status: 401 });
  try {
    const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/kyc/verify-identity-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization, 'X-Session-ID': sessionId }, body: JSON.stringify(await request.json()), cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const data = await response.json().catch(() => ({ success: false, error: 'Invalid KYC backend response' }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ success: false, error: { code: 'KYC_BACKEND_UNAVAILABLE', message: 'KYC service is unavailable.' } }, { status: 503 });
  }
}
