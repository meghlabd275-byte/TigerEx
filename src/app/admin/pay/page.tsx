'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Pay & Card. */
const spec: ResourceSpec = {
  title: 'Pay & Card',
  description: 'Peer-to-peer transfers sent by email, phone or claim code, with the total settled per asset.',
  endpoint: '/api/admin/pay',
  rowsKey: 'transfers',
  columns: ['transferId', 'senderId', 'recipientRef', 'asset', 'amount', 'status', 'createdAt'],
};

export default function AdminPayPage() {
  return <AdminResource spec={spec} />;
}
