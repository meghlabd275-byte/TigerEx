'use client';

import { useApiResource } from '@/lib/useApiResource';
import { AdminDexShell, Card } from '@/components/dex/AdminDexShell';
import { formatAmount } from '@/lib/dex/format';

interface RevenueResponse {
  bySource: Array<{
    source: string;
    asset: string;
    total: number;
    lp: number;
    vetgr: number;
    treasury: number;
    insurance: number;
    burn: number;
  }>;
  treasury: Array<{ asset: string; account_type: string; balance: number }>;
  insurance: Array<{ contract: string; balance: number }>;
}

export default function AdminDexRevenuePage() {
  const revenue = useApiResource<RevenueResponse>('/api/admin/dex/revenue');
  const bySource = revenue.data?.bySource ?? [];
  const treasury = revenue.data?.treasury ?? [];
  const insurance = revenue.data?.insurance ?? [];

  return (
    <AdminDexShell
      title="Revenue"
      subtitle="Every settled fee is written to the revenue ledger with its split, so these figures are the venue's own accounting rather than an estimate."
    >
      <Card title="Revenue by source" className="mb-4">
        {revenue.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading revenue…</p>}
        {revenue.error && <p className="text-sm text-red-600 dark:text-red-400">{revenue.error}</p>}
        {!revenue.loading && bySource.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No revenue has been recorded yet.</p>
        )}
        {bySource.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-gray-500 dark:text-slate-400">
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Source</th>
                  <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Asset</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Total</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">LPs</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">veTGR</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Treasury</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Insurance</th>
                  <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Burn</th>
                </tr>
              </thead>
              <tbody>
                {bySource.map((row) => (
                  <tr key={`${row.source}-${row.asset}`}>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{row.source}</td>
                    <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{row.asset}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(row.total)}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(row.lp)}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(row.vetgr)}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(row.treasury)}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(row.insurance)}</td>
                    <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(row.burn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Treasury accounts">
          {treasury.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No DEX treasury account holds a balance.</p>}
          {treasury.length > 0 && (
            <ul className="space-y-1 text-sm">
              {treasury.map((account) => (
                <li key={`${account.account_type}-${account.asset}`} className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-300">
                    {account.account_type} · {account.asset}
                  </span>
                  <span className="font-medium">{formatAmount(account.balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Insurance funds">
          {insurance.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No DEX insurance fund is funded.</p>}
          {insurance.length > 0 && (
            <ul className="space-y-1 text-sm">
              {insurance.map((fund) => (
                <li key={fund.contract} className="flex justify-between">
                  <span className="text-gray-600 dark:text-slate-300">{fund.contract}</span>
                  <span className="font-medium">{formatAmount(fund.balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AdminDexShell>
  );
}
