'use client';

import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';

/**
 * Perpetual contract listing administration.
 *
 * Perpetuals share `futures_markets` with dated contracts; this surface fixes
 * the listing type to `perpetual` and refuses a delivery time.
 */
const spec: ListingSpec = {
  title: 'Perpetual Contracts',
  description:
    'List perpetual contracts settled in USDT, USDC, RUSD, RYUSD, BTC, ETH or TGR. A perpetual never carries a delivery time and funds every eight hours by default.',
  endpoint: '/api/admin/perps/markets',
  listKey: 'perps',
  symbolField: 'symbol',
  fields: [
    { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'BTC/USDT' },
    { name: 'baseAsset', label: 'Base asset', type: 'text', placeholder: 'BTC' },
    { name: 'quoteAsset', label: 'Quote asset', type: 'text', placeholder: 'USDT' },
    { name: 'settlementAsset', label: 'Settlement', type: 'select', options: ['USDT', 'USDC', 'RUSD', 'RYUSD', 'BTC', 'ETH', 'TGR'], required: true },
    { name: 'contractType', label: 'Contract type', type: 'select', options: ['USDT_M', 'USDC_M', 'RUSD_M', 'RYUSD_M', 'COIN_M', 'TGR_M'], required: true },
    { name: 'contractSize', label: 'Contract size', type: 'number', step: 'any', required: true, placeholder: '1' },
    { name: 'tickSize', label: 'Tick size', type: 'number', step: 'any', required: true, placeholder: '0.1' },
    { name: 'pricePrecision', label: 'Price precision', type: 'number', step: '1', required: true, placeholder: '2' },
    { name: 'quantityPrecision', label: 'Quantity precision', type: 'number', step: '1', required: true, placeholder: '4' },
    { name: 'minQuantity', label: 'Min quantity', type: 'number', step: 'any', required: true, placeholder: '0.001' },
    { name: 'maxQuantity', label: 'Max quantity', type: 'number', step: 'any', required: true, placeholder: '1000' },
    { name: 'maxLeverage', label: 'Max leverage', type: 'number', step: '1', required: true, placeholder: '125' },
    { name: 'makerFeeBps', label: 'Maker fee (bps)', type: 'number', step: 'any', required: true, placeholder: '2' },
    { name: 'takerFeeBps', label: 'Taker fee (bps)', type: 'number', step: 'any', required: true, placeholder: '5' },
    { name: 'fundingIntervalHours', label: 'Funding interval (h)', type: 'number', step: 'any', required: true, placeholder: '8' },
    { name: 'fundingRateCap', label: 'Funding cap', type: 'number', step: 'any', required: true, placeholder: '0.01' },
    { name: 'maintenanceMarginRate', label: 'Maintenance margin', type: 'number', step: 'any', required: true, placeholder: '0.005' },
    { name: 'initialMarginRate', label: 'Initial margin', type: 'number', step: 'any', required: true, placeholder: '0.008' },
    { name: 'liquidationFeeRate', label: 'Liquidation fee', type: 'number', step: 'any', required: true, placeholder: '0.005' },
    { name: 'insuranceFundShare', label: 'Insurance fund share', type: 'number', step: 'any', required: true, placeholder: '0.1' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting', 'maintenance'], required: true },
  ],
};

export default function AdminPerpsPage() {
  return <ListingManager spec={spec} />;
}
