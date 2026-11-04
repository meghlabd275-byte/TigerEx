'use client';

import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';

/**
 * Margin market listing administration.
 *
 * Cross and isolated pools share `margin_markets`; an isolated pool is the same
 * row with `mode = 'isolated'`. Each collateral asset's LTV must be below its
 * own liquidation threshold, and every collateral asset needs a threshold.
 */
const spec: ListingSpec = {
  title: 'Margin Markets',
  description:
    'List cross and isolated margin pools. Collateral LTV and liquidation thresholds are objects mapping asset to fraction; every collateral asset must appear in both, and its LTV must be below its own threshold.',
  endpoint: '/api/admin/margin/markets',
  listKey: 'markets',
  symbolField: 'symbol',
  defaults: {
    mode: 'cross',
    maxLeverage: 10,
    collateralLtv: '{"BTC":0.7,"RUSD":0.9}',
    liquidationThresholds: '{"BTC":0.75,"RUSD":0.95}',
    borrowableAssets: '["RUSD","USDT","USDC"]',
    interestBaseApr: 0.05,
    interestKinkUtilization: 0.8,
    interestKinkApr: 0.5,
    interestMaxApr: 1,
    liquidationBonus: 0.05,
    riskTier: 'medium',
    status: 'active',
  },
  fields: [
    { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'BTC/RUSD' },
    { name: 'baseAsset', label: 'Base asset', type: 'text', placeholder: 'BTC' },
    { name: 'quoteAsset', label: 'Quote asset', type: 'text', placeholder: 'RUSD' },
    { name: 'mode', label: 'Mode', type: 'select', options: ['cross', 'isolated'], required: true },
    { name: 'maxLeverage', label: 'Max leverage', type: 'number', step: '1', required: true, placeholder: '10', help: '1 to 10' },
    { name: 'collateralLtv', label: 'Collateral LTV', type: 'json', required: true, help: 'JSON object, e.g. {"BTC":0.7}' },
    { name: 'liquidationThresholds', label: 'Liquidation thresholds', type: 'json', required: true, help: 'JSON object, one per collateral asset' },
    { name: 'borrowableAssets', label: 'Borrowable assets', type: 'json', required: true, help: 'JSON array, e.g. ["RUSD","USDT"]' },
    { name: 'interestBaseApr', label: 'Base APR', type: 'number', step: 'any', placeholder: '0.05' },
    { name: 'interestKinkUtilization', label: 'Kink utilization', type: 'number', step: 'any', placeholder: '0.8' },
    { name: 'interestKinkApr', label: 'Kink APR', type: 'number', step: 'any', placeholder: '0.5' },
    { name: 'interestMaxApr', label: 'Max APR', type: 'number', step: 'any', placeholder: '1' },
    { name: 'liquidationBonus', label: 'Liquidation bonus', type: 'number', step: 'any', placeholder: '0.05' },
    { name: 'riskTier', label: 'Risk tier', type: 'select', options: ['low', 'medium', 'high'] },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting'], required: true },
  ],
};

export default function AdminMarginPage() {
  return <ListingManager spec={spec} />;
}
