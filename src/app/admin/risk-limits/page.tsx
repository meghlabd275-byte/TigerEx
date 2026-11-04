'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Risk Limits. */
const spec: ResourceSpec = {
  title: 'Risk Limits',
  description: 'Position tiers per contract. A higher tier must raise the notional cap and can never allow more leverage than a lower tier.',
  endpoint: '/api/admin/risk-limits',
  rowsKey: 'limits',
  columns: ['symbol', 'tier', 'maxPositionNotional', 'maxLeverage', 'maintenanceMarginRate'],
  actions: [
    {
      label: 'Set tier',
      method: 'POST',
      fields: [
        { name: 'symbol', label: 'Symbol' },
        { name: 'tier', label: 'Tier', type: 'number' },
        { name: 'maxPositionNotional', label: 'Max notional', type: 'number' },
        { name: 'maxLeverage', label: 'Max leverage', type: 'number' },
        { name: 'maintenanceMarginRate', label: 'Maintenance rate', type: 'number' },
      ],
      body: (values) => ({
        symbol: values.symbol,
        tier: Number(values.tier),
        maxPositionNotional: Number(values.maxPositionNotional),
        maxLeverage: Number(values.maxLeverage),
        maintenanceMarginRate: Number(values.maintenanceMarginRate),
      }),
    },
  ],
};

export default function AdminRiskLimitsPage() {
  return <AdminResource spec={spec} />;
}
