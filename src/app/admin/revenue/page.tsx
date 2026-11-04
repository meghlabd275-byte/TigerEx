'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Revenue. */
const spec: ResourceSpec = {
  title: 'Revenue',
  description: 'Fee, interest and liquidation income grouped by category and by day. Every figure is summed from settled transactions.',
  endpoint: '/api/admin/revenue',
  rowsKey: 'byCategory',
  columns: ['category', 'amount'],
};

export default function AdminRevenuePage() {
  return <AdminResource spec={spec} />;
}
