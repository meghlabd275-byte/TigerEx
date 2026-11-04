'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Launchpad. */
const spec: ResourceSpec = {
  title: 'Launchpad',
  description: 'Token sale projects with their sale price, allocation and vesting. Subscriptions and raised totals are read from live commitments.',
  endpoint: '/api/admin/launchpad',
  rowsKey: 'projects',
  columns: ['projectId', 'tokenSymbol', 'name', 'salePrice', 'totalAllocation', 'raised', 'status'],
};

export default function AdminLaunchpadPage() {
  return <AdminResource spec={spec} />;
}
