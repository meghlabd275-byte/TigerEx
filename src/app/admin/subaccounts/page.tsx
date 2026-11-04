'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Sub-accounts. */
const spec: ResourceSpec = {
  title: 'Sub-accounts',
  description: 'Sub-accounts owned by a parent user, each with its own label, permissions and isolated balance.',
  endpoint: '/api/admin/subaccounts',
  rowsKey: 'subaccounts',
  columns: ['subaccountId', 'parentUserId', 'email', 'label', 'permissions', 'status', 'createdAt'],
};

export default function AdminSubaccountsPage() {
  return <AdminResource spec={spec} />;
}
