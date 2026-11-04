'use client';

import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';

/**
 * Futures and dated contract listing administration.
 *
 * Covers linear (USDT/USDC/RUSD/RYUSD/TGR-margined), inverse (COIN_M) and
 * dated (quarterly/delivery) contracts. A perpetual must not carry a delivery
 * time; the route and validator enforce it.
 */
const spec: ListingSpec = {
  title: 'Futures Markets',
  description:
    'List linear, inverse and dated futures. A perpetual must not carry a delivery time; a dated contract must. Initial margin must be at least maintenance margin.',
  endpoint: '/api/admin/futures/markets',
  listKey: 'markets',
  symbolField: 'symbol',
  fields: [
    { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'BTC/USDT' },
    { name: 'baseAsset', label: 'Base asset', type: 'text', placeholder: 'BTC' },
    { name: 'quoteAsset', label: 'Quote asset', type: 'text', placeholder: 'USDT' },
    { name: 'settlementAsset', label: 'Settlement', type: 'select', options: ['USDT', 'USDC', 'RUSD', 'RYUSD', 'BTC', 'ETH', 'TGR'], required: true },
    { name: 'contractType', label: 'Contract type', type: 'select', options: ['USDT_M', 'USDC_M', 'RUSD_M', 'RYUSD_M', 'COIN_M', 'TGR_M'], required: true },
    { name: 'listingType', label: 'Listing type', type: 'select', options: ['perpetual', 'quarterly', 'bi_quarterly', 'delivery'], required: true },
    { name: 'contractSize', label: 'Contract size', type: 'number', step: 'any', required: true, placeholder: '1' },
    { name: 'tickSize', label: 'Tick size', type: 'number', step: 'any', required: true, placeholder: '0.1' },
    { name: 'pricePrecision', label: 'Price precision', type: 'number', step: '1', required: true, placeholder: '2' },
    { name: 'quantityPrecision', label: 'Quantity precision', type: 'number', step: '1', required: true, placeholder: '4' },
    { name: 'minQuantity', label: 'Min quantity', type: 'number', step: 'any', required: true, placeholder: '0.001' },
    { name: 'maxQuantity', label: 'Max quantity', type: 'number', step: 'any', required: true, placeholder: '1000' },
    { name: 'maxLeverage', label: 'Max leverage', type: 'number', step: '1', required: true, placeholder: '125', help: 'Up to 1001' },
    { name: 'makerFeeBps', label: 'Maker fee (bps)', type: 'number', step: 'any', required: true, placeholder: '2' },
    { name: 'takerFeeBps', label: 'Taker fee (bps)', type: 'number', step: 'any', required: true, placeholder: '5' },
    { name: 'fundingIntervalHours', label: 'Funding interval (h)', type: 'number', step: 'any', required: true, placeholder: '8' },
    { name: 'fundingRateCap', label: 'Funding cap', type: 'number', step: 'any', required: true, placeholder: '0.01' },
    { name: 'maintenanceMarginRate', label: 'Maintenance margin', type: 'number', step: 'any', required: true, placeholder: '0.005' },
    { name: 'initialMarginRate', label: 'Initial margin', type: 'number', step: 'any', required: true, placeholder: '0.008' },
    { name: 'liquidationFeeRate', label: 'Liquidation fee', type: 'number', step: 'any', required: true, placeholder: '0.005' },
    { name: 'insuranceFundShare', label: 'Insurance fund share', type: 'number', step: 'any', required: true, placeholder: '0.1' },
    { name: 'deliveryTimeNs', label: 'Delivery time (ns)', type: 'number', step: '1', help: 'Required for dated contracts; leave empty for a perpetual' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting', 'maintenance'], required: true },
  ],
};

export default function AdminFuturesPage() {
  return <ListingManager spec={spec} />;
}
