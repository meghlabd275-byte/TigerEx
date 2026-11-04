'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** P2P. */
const spec: ResourceSpec = {
  title: 'P2P',
  description: 'Merchant ads and open disputes. Resolving a dispute splits the escrow between buyer and seller; the order stays locked until then.',
  endpoint: '/api/admin/p2p',
  rowsKey: 'disputes',
  columns: ['disputeId', 'orderId', 'openedBy', 'reason', 'status', 'resolution', 'createdAt'],
};

export default function AdminP2pPage() {
  return <AdminResource spec={spec} />;
}
