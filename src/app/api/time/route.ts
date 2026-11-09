import { NextRequest, NextResponse } from 'next/server';

// This handler reads live state on every request. Without an explicit
// dynamic marker Next.js would prerender it once at build time and serve
// that frozen response forever, so the client would never see a pool it
// just created, a swap it just settled, or the current server time.
export const dynamic = 'force-dynamic';

// Get server time
export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      data: {
        serverTime: Date.now(),
        iso: new Date().toISOString(),
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
