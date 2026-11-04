'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Bots. */
const spec: ResourceSpec = {
  title: 'Bots',
  description: 'Trading bots with their strategy, market and realized PnL. Changing a strategy is previewed before it is applied.',
  endpoint: '/api/admin/bots',
  rowsKey: 'bots',
  columns: ['botId', 'userId', 'strategy', 'symbol', 'status', 'realizedPnl', 'createdAt'],
};

export default function AdminBotsPage() {
  return <AdminResource spec={spec} />;
}
