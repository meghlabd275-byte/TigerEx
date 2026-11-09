/**
 * Shared helpers for the TigerSwap API routes.
 *
 * A DEX service throws a typed `DexError` for a business failure (insufficient
 * balance, paused market, unknown pool) and lets an unexpected error propagate.
 * This module turns the first into a structured response and rethrows the
 * second, so every route reports the same error envelope without each one
 * re-implementing the mapping.
 */

import { NextResponse } from 'next/server';
import { DexError } from '@/lib/dex/pool-service';
import { AmmError } from '@/lib/dex/amm';
import { LedgerError } from '@/lib/db/ledger';

export interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string };
}

/** Convert a thrown error into a response, or rethrow when it is unexpected. */
export function dexFailure(error: unknown): NextResponse {
  if (error instanceof DexError) {
    return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof LedgerError) {
    return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof AmmError) {
    return NextResponse.json({ success: false, error: { code: error.code, message: error.message } }, { status: 400 });
  }
  throw error;
}

/** A successful JSON response that must never be cached. */
export function dexOk(payload: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ success: true, ...payload }, { status, headers: { 'Cache-Control': 'no-store' } });
}
