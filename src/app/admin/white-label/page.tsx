'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** White Label. */
const spec: ResourceSpec = {
  title: 'White Label',
  description: 'White-label clients with their domain, branding and status.',
  endpoint: '/api/admin/white-label',
  rowsKey: 'clients',
  columns: ['id', 'name', 'domain', 'status', 'createdAt'],
};

export default function AdminWhiteLabelPage() {
  return <AdminResource spec={spec} />;
}
