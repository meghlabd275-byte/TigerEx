'use client';

import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';

/**
 * Leveraged token (ETF) listing administration.
 *
 * A leveraged token's symbol carries its multiple in the base (`BTC3L`), so the
 * underlying must be a prefix of the base rather than equal to it.
 */
const spec: ListingSpec = {
  title: 'Leveraged Tokens',
  description:
    'List 3x long and short tokens such as BTC3L/RUSD. The underlying must be a prefix of the symbol base, and the leverage must be an integer in [1, 20].',
  endpoint: '/api/admin/etf/markets',
  listKey: 'markets',
  symbolField: 'symbol',
  fields: [
    { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'BTC3L/RUSD' },
    { name: 'underlying', label: 'Underlying', type: 'text', placeholder: 'BTC', help: 'Prefix of the symbol base' },
    { name: 'settlementAsset', label: 'Settlement', type: 'select', options: ['USDT', 'USDC', 'RUSD', 'RYUSD', 'BTC', 'ETH', 'TGR'], required: true },
    { name: 'leverage', label: 'Leverage', type: 'number', step: '1', required: true, placeholder: '3', help: '1 to 20' },
    { name: 'direction', label: 'Direction', type: 'select', options: ['long', 'short'], required: true },
    { name: 'nav', label: 'NAV', type: 'number', step: 'any', required: true, placeholder: '1' },
    { name: 'rebalanceThreshold', label: 'Rebalance threshold', type: 'number', step: 'any', placeholder: '0.05' },
    { name: 'managementFeeApr', label: 'Management fee APR', type: 'number', step: 'any', placeholder: '0.02' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting', 'maintenance'], required: true },
  ],
};

export default function AdminEtfPage() {
  return <ListingManager spec={spec} />;
}
