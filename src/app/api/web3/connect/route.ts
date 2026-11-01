import { NextRequest, NextResponse } from 'next/server';
import { backendBaseUrl } from '@/lib/backend-url';


function configuredApiBase(): string | null {
  return backendBaseUrl();
}

export async function POST(request: NextRequest) {
  const baseUrl = configuredApiBase();
  if (!baseUrl) return NextResponse.json({ success: false, error: { code: 'API_NOT_CONFIGURED', message: 'A secure Web3 backend is not configured.' } }, { status: 503 });
  try {
    const authorization = request.headers.get('authorization');
    const body = await request.json();
    if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) return NextResponse.json({ success: false, error: 'Authorization required' }, { status: 401 });
    const { walletAddress, signature, message } = body ?? {};
    if (typeof walletAddress !== 'string' || typeof signature !== 'string' || typeof message !== 'string' || !walletAddress || !signature || !message || message.length > 4096 || signature.length > 4096 || walletAddress.length > 256) {
      return NextResponse.json({ success: false, error: 'Missing or invalid Web3 connection parameters' }, { status: 400 });
    }
    const response = await fetch(`${baseUrl}/web3/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ walletAddress, signature, message }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => ({ success: false, error: 'Invalid backend response' }));
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ success: false, error: { code: 'WEB3_BACKEND_UNAVAILABLE', message: 'Web3 backend is unavailable.' } }, { status: 503 });
  }
}
