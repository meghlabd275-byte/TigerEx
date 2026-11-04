'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Buyback & Burn. */
const spec: ResourceSpec = {
  title: 'Buyback & Burn',
  description: 'Each record is a completed buyback and burn with its transaction reference. The fee share is a fraction in [0, 1].',
  endpoint: '/api/admin/buyback',
  rowsKey: 'records',
  columns: ['recordId', 'asset', 'quoteAsset', 'amountSpent', 'assetBought', 'assetBurned', 'txRef'],
  actions: [
    {
      label: 'Record buyback',
      method: 'POST',
      fields: [
        { name: 'asset', label: 'Asset bought' },
        { name: 'quoteAsset', label: 'Quote asset' },
        { name: 'amountSpent', label: 'Amount spent', type: 'number' },
        { name: 'assetBought', label: 'Bought', type: 'number' },
        { name: 'assetBurned', label: 'Burned', type: 'number' },
        { name: 'txRef', label: 'Transaction reference' },
      ],
      body: (values) => ({
        asset: values.asset,
        quoteAsset: values.quoteAsset,
        amountSpent: Number(values.amountSpent),
        assetBought: Number(values.assetBought),
        assetBurned: Number(values.assetBurned),
        txRef: values.txRef,
      }),
    },
  ],
};

export default function AdminBuybackPage() {
  return <AdminResource spec={spec} />;
}
