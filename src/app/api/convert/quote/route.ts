import { NextRequest, NextResponse } from 'next/server';
import { quoteConvert } from '@/lib/db/convert';

/** Live conversion quote derived from real market data. Public (no session needed). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fromAsset = (searchParams.get('fromAsset') || '').toUpperCase();
  const toAsset = (searchParams.get('toAsset') || '').toUpperCase();
  const amount = parseFloat(searchParams.get('amount') || '0');

  if (!fromAsset || !toAsset || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_PARAMS', message: 'fromAsset, toAsset and a positive amount are required' } },
      { status: 400 },
    );
  }

  try {
    const quote = quoteConvert(fromAsset, toAsset, amount);
    if (!quote) {
      return NextResponse.json(
        { success: false, error: { code: 'RATE_UNAVAILABLE', message: 'No market price is available for this pair' } },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, data: quote }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Convert quote error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
