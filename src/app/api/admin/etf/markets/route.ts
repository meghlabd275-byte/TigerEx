import { NextRequest } from 'next/server';
import { createCrudRoute } from '@/lib/api/crud';
import { validateEtfMarket } from '@/lib/markets/instruments';

/**
 * Leveraged token (ETF) listing administration.
 *
 * A 3x long token is listed as `BTC3L/RUSD`; the underlying is `BTC`, the
 * leverage 3 and the direction `long`. NAV is the issuance price and the
 * rebalancer maintains it from there.
 */

const route = createCrudRoute<Record<string, unknown>>({
  table: 'etf_markets',
  idColumn: 'market_id',
  auditPrefix: 'market.etf',
  targetType: 'etf_market',
  symbolColumn: 'symbol',
  fields: [
    { field: 'symbol', column: 'symbol' },
    { field: 'underlying', column: 'underlying' },
    { field: 'settlementAsset', column: 'settlement_asset' },
    { field: 'leverage', column: 'leverage' },
    { field: 'direction', column: 'direction' },
    { field: 'nav', column: 'nav' },
    { field: 'rebalanceThreshold', column: 'rebalance_threshold' },
    { field: 'managementFeeApr', column: 'management_fee_apr' },
    { field: 'status', column: 'status' },
  ],
  validate: (body) => {
    const validated = validateEtfMarket(body);
    if ('error' in validated) return { error: validated.error };
    return { record: validated.market as unknown as Record<string, unknown> };
  },
  beforeDelete: (db, symbol) => {
    const holders = db
      .prepare("SELECT COUNT(*) AS n FROM balances WHERE currency = ? AND (available > 0 OR locked > 0)")
      .get(symbol.split('/')[0]) as { n: number };
    if (holders.n > 0) {
      return `${symbol} still has token holders; pause it instead of delisting`;
    }
    return null;
  },
});

export const GET = (request: NextRequest) => route.GET(request);
export const POST = (request: NextRequest) => route.POST(request);
export const PUT = (request: NextRequest) => route.PUT(request);
export const DELETE = (request: NextRequest) => route.DELETE(request);
