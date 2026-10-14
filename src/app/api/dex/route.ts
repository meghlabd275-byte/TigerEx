import { NextResponse } from 'next/server';

const unavailable = () =>
  NextResponse.json(
    {
      success: false,
      error: 'DEX integration is not configured. No quote, swap, or transaction status is available.',
      code: 'DEX_PROVIDER_NOT_CONFIGURED',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );

export async function GET() {
  return unavailable();
}

export async function POST() {
  return unavailable();
}
