'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Emergency Pause. */
const spec: ResourceSpec = {
  title: 'Emergency Pause',
  description: 'Pause a single market, a product family or the whole exchange. A pause takes effect on the next request; it is not a background job.',
  endpoint: '/api/admin/pause',
  rowsKey: 'controls',
  columns: ['scope', 'paused', 'reason', 'updatedBy', 'updatedAt'],
};

export default function AdminPausePage() {
  return <AdminResource spec={spec} />;
}
