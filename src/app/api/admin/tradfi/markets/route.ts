import { NextRequest } from 'next/server';
import { createCrudRoute } from '@/lib/api/crud';
import { validateTradFiMarket } from '@/lib/markets/instruments';

/**
 * TradFi instrument listing administration.
 *
 * Stocks, FX, commodities and indices traded 24/7 and settled in the exchange
 * stablecoin. The reference symbol names the feed the price source publishes;
 * an instrument without it has no price and cannot be listed.
 */

const route = createCrudRoute<Record<string, unknown>>({
  table: 'tradfi_markets',
  idColumn: 'market_id',
  auditPrefix: 'market.tradfi',
  targetType: 'tradfi_market',
  symbolColumn: 'symbol',
  fields: [
    { field: 'symbol', column: 'symbol' },
    { field: 'instrumentType', column: 'instrument_type' },
    { field: 'settlementAsset', column: 'settlement_asset' },
    { field: 'priceSource', column: 'price_source' },
    { field: 'referenceSymbol', column: 'reference_symbol' },
    { field: 'tickSize', column: 'tick_size' },
    { field: 'minQuantity', column: 'min_quantity' },
    { field: 'maxQuantity', column: 'max_quantity' },
    { field: 'maxLeverage', column: 'max_leverage' },
    { field: 'makerFeeBps', column: 'maker_fee_bps' },
    { field: 'takerFeeBps', column: 'taker_fee_bps' },
    { field: 'tradingHours', column: 'trading_hours' },
    { field: 'status', column: 'status' },
  ],
  validate: (body) => {
    const validated = validateTradFiMarket(body);
    if ('error' in validated) return { error: validated.error };
    return { record: validated.market as unknown as Record<string, unknown> };
  },
});

export const GET = (request: NextRequest) => route.GET(request);
export const POST = (request: NextRequest) => route.POST(request);
export const PUT = (request: NextRequest) => route.PUT(request);
export const DELETE = (request: NextRequest) => route.DELETE(request);
