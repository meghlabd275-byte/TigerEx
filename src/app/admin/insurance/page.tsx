'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Insurance Fund. */
const spec: ResourceSpec = {
  title: 'Insurance Fund',
  description: 'The fund balance per contract, its target, fee contribution and ADL threshold. A contract below its ADL threshold arms auto-deleveraging.',
  endpoint: '/api/admin/insurance',
  rowsKey: 'funds',
  columns: ['contract', 'balance', 'targetBalance', 'feeShare', 'adlThreshold', 'adlEnabled', 'healthy'],
};

export default function AdminInsurancePage() {
  return <AdminResource spec={spec} />;
}
