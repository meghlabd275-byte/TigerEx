'use client';

import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';

/**
 * TradFi listing administration.
 *
 * Stocks, forex, commodities and indices are priced from the exchange's own
 * oracle or index, so a reference symbol and price source are required.
 */
const spec: ListingSpec = {
  title: 'TradFi Markets',
  description:
    'List stocks, forex, commodities and indices settled in exchange assets. A reference symbol and a price source are required; there is no dependency on an external broker feed.',
  endpoint: '/api/admin/tradfi/markets',
  listKey: 'markets',
  symbolField: 'symbol',
  fields: [
    { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'TSLA/RUSD' },
    { name: 'instrumentType', label: 'Instrument type', type: 'select', options: ['stock', 'forex', 'commodity', 'index'], required: true },
    { name: 'settlementAsset', label: 'Settlement', type: 'select', options: ['USDT', 'USDC', 'RUSD', 'RYUSD', 'BTC', 'ETH', 'TGR'], required: true },
    { name: 'priceSource', label: 'Price source', type: 'select', options: ['oracle', 'tiger_index', 'reference_feed'], required: true },
    { name: 'referenceSymbol', label: 'Reference symbol', type: 'text', required: true, placeholder: 'TSLA' },
    { name: 'tickSize', label: 'Tick size', type: 'number', step: 'any', required: true, placeholder: '0.01' },
    { name: 'minQuantity', label: 'Min quantity', type: 'number', step: 'any', required: true, placeholder: '0.01' },
    { name: 'maxQuantity', label: 'Max quantity', type: 'number', step: 'any', required: true, placeholder: '10000' },
    { name: 'maxLeverage', label: 'Max leverage', type: 'number', step: '1', placeholder: '1', help: '1 to 100' },
    { name: 'makerFeeBps', label: 'Maker fee (bps)', type: 'number', step: '1', placeholder: '2' },
    { name: 'takerFeeBps', label: 'Taker fee (bps)', type: 'number', step: '1', placeholder: '5' },
    { name: 'tradingHours', label: 'Trading hours', type: 'text', placeholder: '24/7' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting', 'maintenance'], required: true },
  ],
};

export default function AdminTradFiPage() {
  return <ListingManager spec={spec} />;
}
