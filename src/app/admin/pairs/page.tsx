'use client';

import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';

/**
 * Spot market listing administration.
 *
 * Lists the pair in `trading_pairs` through `/api/admin/pairs`, which validates
 * the tick, bounds and fees before writing and audits the change.
 */
const spec: ListingSpec = {
  title: 'Spot Markets',
  description:
    'List and delist spot pairs. A pair needs a positive tick size, ordered price and quantity bounds, and a fee that is a fraction in [0, 1).',
  endpoint: '/api/admin/pairs',
  listKey: 'markets',
  symbolField: 'symbol',
  fields: [
    { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'BTC/RUSD' },
    { name: 'baseCurrency', label: 'Base asset', type: 'text', help: 'Must match the symbol base' },
    { name: 'quoteCurrency', label: 'Quote asset', type: 'text', help: 'Must match the symbol quote' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting'], required: true },
    { name: 'tickSize', label: 'Tick size', type: 'number', step: 'any', required: true, placeholder: '0.01' },
    { name: 'minPrice', label: 'Min price', type: 'number', step: 'any', required: true, placeholder: '0.01' },
    { name: 'maxPrice', label: 'Max price', type: 'number', step: 'any', required: true, placeholder: '1000000' },
    { name: 'minQuantity', label: 'Min quantity', type: 'number', step: 'any', required: true, placeholder: '0.0001' },
    { name: 'maxQuantity', label: 'Max quantity', type: 'number', step: 'any', required: true, placeholder: '100000' },
    { name: 'minNotional', label: 'Min notional', type: 'number', step: 'any', placeholder: '1' },
    { name: 'makerFee', label: 'Maker fee', type: 'number', step: 'any', placeholder: '0.001' },
    { name: 'takerFee', label: 'Taker fee', type: 'number', step: 'any', placeholder: '0.001' },
  ],
};

export default function AdminPairsPage() {
  return <ListingManager spec={spec} />;
}
