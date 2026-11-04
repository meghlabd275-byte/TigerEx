'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Liquidation. */
const spec: ResourceSpec = {
  title: 'Liquidation',
  description: 'Instructions to liquidation bots, created by the risk engine when a position breaches its maintenance margin. Only legal transitions are accepted.',
  endpoint: '/api/admin/liquidation',
  rowsKey: 'queue',
  columns: ['entryId', 'symbol', 'userId', 'side', 'quantity', 'status', 'createdAt'],
  actions: [
    {
      label: 'Update status',
      method: 'PUT',
      fields: [
        { name: 'entryId', label: 'Entry id' },
        { name: 'status', label: 'Status', type: 'select', options: ['pending', 'claimed', 'executed', 'cancelled'] },
      ],
      body: (values) => ({ entryId: values.entryId, status: values.status }),
    },
  ],
};

export default function AdminLiquidationPage() {
  return <AdminResource spec={spec} />;
}
