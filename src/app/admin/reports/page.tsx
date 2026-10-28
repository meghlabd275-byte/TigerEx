'use client';

/**
 * Reports. Summary figures come from the live admin statistics endpoint and the
 * export writes exactly those figures to CSV; no value is estimated.
 */

import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface ExchangeStats {
  totalUsers?: number;
  activeUsers24h?: number;
  kycLevel1Plus?: number;
  openOrders?: number;
  orders24h?: number;
  pendingWithdrawals?: number;
  pendingDeposits?: number;
  activeMarkets?: number;
  totalVolume24h?: number;
}

const METRICS: { key: keyof ExchangeStats; label: string; digits: number }[] = [
  { key: 'totalUsers', label: 'Total Users', digits: 0 },
  { key: 'activeUsers24h', label: 'Active Users 24h', digits: 0 },
  { key: 'kycLevel1Plus', label: 'Verified Users (KYC >= 1)', digits: 0 },
  { key: 'orders24h', label: 'Orders 24h', digits: 0 },
  { key: 'openOrders', label: 'Open Orders', digits: 0 },
  { key: 'totalVolume24h', label: 'Volume 24h', digits: 2 },
  { key: 'pendingDeposits', label: 'Pending Deposits', digits: 0 },
  { key: 'pendingWithdrawals', label: 'Pending Withdrawals', digits: 0 },
  { key: 'activeMarkets', label: 'Active Markets', digits: 0 },
];

function formatNumber(value: number | undefined, digits: number): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function AdminReportsPage() {
  const stats = useApiResource<ExchangeStats>('/api/admin/stats');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      METRICS.map((metric) => ({
        label: metric.label,
        value: stats.data?.[metric.key],
        display: formatNumber(stats.data?.[metric.key], metric.digits),
      })),
    [stats.data],
  );

  const exportCsv = () => {
    if (!stats.data) return;
    const header = 'metric,value';
    const body = rows
      .map((row) => `"${row.label}",${row.value ?? ''}`)
      .join('\n');
    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tigerex-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setGeneratedAt(new Date().toLocaleString());
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Reports</h1>
          <button
            onClick={stats.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {stats.loading && <p className="text-sm text-gray-500">Loading statistics…</p>}
        {stats.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Statistics are unavailable: {stats.error}
          </div>
        )}

        {!stats.loading && !stats.error && stats.data && (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
              {rows.slice(0, 4).map((row) => (
                <div key={row.label} className="rounded-lg bg-white p-4 shadow">
                  <div className="text-sm text-gray-500">{row.label}</div>
                  <div className="text-2xl font-bold">{row.display}</div>
                </div>
              ))}
            </div>

            <div className="mb-6 rounded-lg bg-white p-6 shadow">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Export Current Figures</h2>
                <button
                  onClick={exportCsv}
                  className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
                >
                  Download CSV
                </button>
              </div>
              {generatedAt && (
                <p className="mt-2 text-sm text-gray-500">Last export: {generatedAt}</p>
              )}
            </div>

            <div className="overflow-hidden rounded-lg bg-white shadow">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold">Live Exchange Metrics</h2>
              </div>
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Metric
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase text-gray-500">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <td className="px-6 py-4">{row.label}</td>
                      <td className="px-6 py-4 text-right tabular-nums">{row.display}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
