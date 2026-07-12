import { NextRequest, NextResponse } from 'next/server';

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
