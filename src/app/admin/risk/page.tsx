'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Risk. */
const spec: ResourceSpec = {
  title: 'Risk',
  description: 'Every open futures and margin position with its leverage and margin ratio, the liquidation queue, insurance balances and the current funding rate.',
  endpoint: '/api/admin/risk',
  rowsKey: 'data.positions',
  columns: ['symbol', 'side', 'quantity', 'entryPrice', 'markPrice', 'leverage', 'margin', 'marginRatio', 'liquidationPrice'],
};

export default function AdminRiskPage() {
  return <AdminResource spec={spec} />;
}
