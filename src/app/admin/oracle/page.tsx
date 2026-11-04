'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Oracle. */
const spec: ResourceSpec = {
  title: 'Oracle',
  description: 'Price feeds and their weights. A source that deviates past its threshold is rejected before it can move a mark price.',
  endpoint: '/api/admin/oracle',
  rowsKey: 'sources',
  columns: ['sourceId', 'symbol', 'sourceName', 'feedReference', 'weight', 'maxDeviation', 'status'],
};

export default function AdminOraclePage() {
  return <AdminResource spec={spec} />;
}
