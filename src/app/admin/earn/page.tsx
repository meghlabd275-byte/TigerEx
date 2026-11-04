'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Earn. */
const spec: ResourceSpec = {
  title: 'Earn',
  description: 'Earn products with their asset, APY, term and cap. The APY is stored as a fraction and applied by the accrual job.',
  endpoint: '/api/admin/earn',
  rowsKey: 'products',
  columns: ['productId', 'name', 'productType', 'asset', 'apy', 'durationDays', 'cap', 'status'],
};

export default function AdminEarnPage() {
  return <AdminResource spec={spec} />;
}
