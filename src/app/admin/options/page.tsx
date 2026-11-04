'use client';

import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';

/**
 * Options listing administration.
 *
 * An option needs a positive strike and a future expiry, expressed as a
 * nanosecond timestamp. The route rejects a past expiry before it is written.
 */
const spec: ListingSpec = {
  title: 'Options Markets',
  description:
    'List European and American calls and puts. Strike must be positive and expiry must be a future nanosecond timestamp.',
  endpoint: '/api/admin/options/markets',
  listKey: 'markets',
  symbolField: 'symbol',
  fields: [
    { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'BTC/RUSD' },
    { name: 'underlying', label: 'Underlying', type: 'text', placeholder: 'BTC', help: 'Must match the symbol base' },
    { name: 'settlementAsset', label: 'Settlement', type: 'select', options: ['USDT', 'USDC', 'RUSD', 'RYUSD', 'BTC', 'ETH', 'TGR'], required: true },
    { name: 'optionType', label: 'Option type', type: 'select', options: ['call', 'put'], required: true },
    { name: 'strikePrice', label: 'Strike price', type: 'number', step: 'any', required: true, placeholder: '50000' },
    { name: 'expiryNs', label: 'Expiry (ns)', type: 'number', step: '1', required: true, placeholder: '1735689600000000000' },
    { name: 'exerciseStyle', label: 'Exercise style', type: 'select', options: ['european', 'american'], required: true },
    { name: 'contractSize', label: 'Contract size', type: 'number', step: 'any', placeholder: '1' },
    { name: 'tickSize', label: 'Tick size', type: 'number', step: 'any', required: true, placeholder: '0.1' },
    { name: 'minQuantity', label: 'Min quantity', type: 'number', step: 'any', required: true, placeholder: '0.01' },
    { name: 'maxQuantity', label: 'Max quantity', type: 'number', step: 'any', required: true, placeholder: '100' },
    { name: 'makerFeeBps', label: 'Maker fee (bps)', type: 'number', step: '1', required: true, placeholder: '2' },
    { name: 'takerFeeBps', label: 'Taker fee (bps)', type: 'number', step: '1', required: true, placeholder: '5' },
    { name: 'impliedVolatility', label: 'Implied volatility', type: 'number', step: 'any', help: 'Optional' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting', 'maintenance'], required: true },
  ],
};

export default function AdminOptionsPage() {
  return <ListingManager spec={spec} />;
}
