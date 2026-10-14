import { NextResponse } from 'next/server';

const unavailable = () =>
  NextResponse.json(
    {
      success: false,
      error: 'Grid trading is unavailable until a persistent strategy service and live execution engine are configured.',
      code: 'GRID_TRADING_NOT_CONFIGURED',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );

export async function GET() {
  return unavailable();
}

export async function POST() {
  return unavailable();
}

export async function PUT() {
  return unavailable();
}

export async function DELETE() {
  return unavailable();
}
