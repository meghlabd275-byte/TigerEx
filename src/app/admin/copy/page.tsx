'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Copy Trading. */
const spec: ResourceSpec = {
  title: 'Copy Trading',
  description: 'Leaders and their performance. A leader is approved explicitly; the profit share is a fraction in [0, 1).',
  endpoint: '/api/admin/copy',
  rowsKey: 'traders',
  columns: ['traderId', 'displayName', 'markets', 'winRate', 'followers', 'aum', 'profitShare', 'status'],
};

export default function AdminCopyPage() {
  return <AdminResource spec={spec} />;
}
