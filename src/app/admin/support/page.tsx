'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Support. */
const spec: ResourceSpec = {
  title: 'Support',
  description: 'User support tickets with their category, priority and status. A reply is stored as a message from an administrator.',
  endpoint: '/api/admin/support',
  rowsKey: 'tickets',
  columns: ['ticketId', 'userId', 'subject', 'category', 'priority', 'status', 'createdAt'],
};

export default function AdminSupportPage() {
  return <AdminResource spec={spec} />;
}
