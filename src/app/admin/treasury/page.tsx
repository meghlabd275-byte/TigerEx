'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Treasury. */
const spec: ResourceSpec = {
  title: 'Treasury',
  description: 'Exchange-controlled wallet balances per chain and asset. A movement is recorded explicitly, never inferred.',
  endpoint: '/api/admin/treasury',
  rowsKey: 'accounts',
  columns: ['accountId', 'asset', 'network', 'accountType', 'balance', 'address'],
  actions: [
    {
      label: 'Record movement',
      method: 'POST',
      fields: [
        { name: 'asset', label: 'Asset' },
        { name: 'network', label: 'Network' },
        { name: 'fromAccount', label: 'From account id' },
        { name: 'toAccount', label: 'To account id' },
        { name: 'amount', label: 'Amount', type: 'number' },
        { name: 'reason', label: 'Reason' },
      ],
      body: (values) => ({
        asset: values.asset,
        network: values.network,
        fromAccount: values.fromAccount,
        toAccount: values.toAccount,
        amount: Number(values.amount),
        reason: values.reason,
      }),
    },
  ],
};

export default function AdminTreasuryPage() {
  return <AdminResource spec={spec} />;
}
