import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/db/session';
import { ConvertError, executeConvert, listConvertHistory } from '@/lib/db/convert';

const MAX_LIMIT = 100;

/** Execute a real conversion for the authenticated user. */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  let body: { fromAsset?: unknown; toAsset?: unknown; amount?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  const fromAsset = String(body.fromAsset ?? '').toUpperCase();
  const toAsset = String(body.toAsset ?? '').toUpperCase();
  const amount = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount ?? ''));

  if (!fromAsset || !toAsset || fromAsset === toAsset) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_PARAMS', message: 'fromAsset and toAsset must differ' } },
      { status: 400 },
    );
  }

  try {
    const result = executeConvert(auth.user.userId, fromAsset, toAsset, amount);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ConvertError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    console.error('Convert trade error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}

/** Conversion history for the authenticated user. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const history = listConvertHistory(auth.user.userId, limit, offset);
    return NextResponse.json({ success: true, data: history }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Convert history error:', error);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
