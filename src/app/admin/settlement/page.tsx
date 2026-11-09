'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/**
 * Settlement.
 *
 * Funding, option expiry and leveraged-token rebalancing are time-driven venue
 * actions. The scheduler runs them through the keeper endpoint; an operator can
 * run the same cycle here and see the venue's funding history.
 */
const spec: ResourceSpec = {
  title: 'Settlement',
  description:
    'Charge due perpetual funding, settle expired option contracts and rebalance leveraged tokens. Every run is audited; a contract with no fresh price is skipped rather than settled at a guess.',
  endpoint: '/api/admin/settlement',
  rowsKey: 'funding',
  columns: ['symbol', 'funding_rate', 'mark_price', 'index_price', 'premium', 'created_at'],
  actions: [
    {
      label: 'Run settlement cycle',
      method: 'POST',
      body: () => ({}),
    },
  ],
};

export default function AdminSettlementPage() {
  return <AdminResource spec={spec} />;
}
