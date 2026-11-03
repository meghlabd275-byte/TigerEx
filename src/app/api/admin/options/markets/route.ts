import { NextRequest } from 'next/server';
import { createCrudRoute } from '@/lib/api/crud';
import { validateOptionsMarket } from '@/lib/markets/instruments';

/**
 * Options market listing administration.
 *
 * One row per (underlying, expiry, strike, type). A European option is
 * cash-settled at expiry, so the expiry must be a future timestamp and the
 * strike must be positive. Settlement defaults to the native stablecoin.
 */

const route = createCrudRoute<Record<string, unknown>>({
  table: 'options_markets',
  idColumn: 'market_id',
  auditPrefix: 'market.options',
  targetType: 'options_market',
  symbolColumn: 'symbol',
  fields: [
    { field: 'symbol', column: 'symbol' },
    { field: 'underlying', column: 'underlying' },
    { field: 'settlementAsset', column: 'settlement_asset' },
    { field: 'optionType', column: 'option_type' },
    { field: 'strikePrice', column: 'strike_price' },
    { field: 'expiryNs', column: 'expiry_ns' },
    { field: 'exerciseStyle', column: 'exercise_style' },
    { field: 'contractSize', column: 'contract_size' },
    { field: 'tickSize', column: 'tick_size' },
    { field: 'minQuantity', column: 'min_quantity' },
    { field: 'maxQuantity', column: 'max_quantity' },
    { field: 'makerFeeBps', column: 'maker_fee_bps' },
    { field: 'takerFeeBps', column: 'taker_fee_bps' },
    { field: 'impliedVolatility', column: 'implied_volatility' },
    { field: 'status', column: 'status' },
  ],
  validate: (body) => {
    const validated = validateOptionsMarket(body, Date.now() * 1e6);
    if ('error' in validated) return { error: validated.error };
    return { record: validated.market as unknown as Record<string, unknown> };
  },
});

export const GET = (request: NextRequest) => route.GET(request);
export const POST = (request: NextRequest) => route.POST(request);
export const PUT = (request: NextRequest) => route.PUT(request);
export const DELETE = (request: NextRequest) => route.DELETE(request);
