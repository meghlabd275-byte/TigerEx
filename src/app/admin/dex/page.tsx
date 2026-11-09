'use client';

import Link from 'next/link';
import { useApiResource } from '@/lib/useApiResource';
import { AdminDexShell, Card } from '@/components/dex/AdminDexShell';
import { formatAmount, formatNumber, formatUsd } from '@/lib/dex/format';

interface PoolsResponse {
  pools: Array<{ poolId: string; status: string; tvlUsd: number | null }>;
}
interface FarmsResponse {
  farms: Array<{ farm_id: string; status: string }>;
  gauges: Array<unknown>;
}
interface MarginResponse {
  markets: Array<{ marketId: string; status: string }>;
}
interface UsersResponse {
  users: Array<{ blocked: number }>;
}
interface RevenueResponse {
  bySource: Array<{ source: string; asset: string; total: number; treasury: number; insurance: number; burn: number }>;
  treasury: Array<{ asset: string; account_type: string; balance: number }>;
  insurance: Array<{ contract: string; balance: number }>;
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">{value}</p>
    </>
  );
  const className =
    'block rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900' +
    (href ? ' transition-colors hover:border-blue-400' : '');
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default function AdminDexOverviewPage() {
  const pools = useApiResource<PoolsResponse>('/api/admin/dex/pools');
  const farms = useApiResource<FarmsResponse>('/api/admin/dex/farms');
  const margin = useApiResource<MarginResponse>('/api/admin/dex/margin');
  const users = useApiResource<UsersResponse>('/api/admin/dex/users');
  const revenue = useApiResource<RevenueResponse>('/api/admin/dex/revenue');

  const activePools = (pools.data?.pools ?? []).filter((pool) => pool.status === 'active');
  const activeFarms = (farms.data?.farms ?? []).filter((farm) => farm.status === 'active');
  const activeMarkets = (margin.data?.markets ?? []).filter((market) => market.status === 'active');
  const blockedUsers = (users.data?.users ?? []).filter((user) => Number(user.blocked) === 1);
  const revenueRows = revenue.data?.bySource ?? [];
  const totalRevenue = revenueRows.reduce((sum, row) => sum + Number(row.total), 0);
  const totalTreasury = revenueRows.reduce((sum, row) => sum + Number(row.treasury), 0);
  const totalInsurance = revenueRows.reduce((sum, row) => sum + Number(row.insurance), 0);
  const totalBurn = revenueRows.reduce((sum, row) => sum + Number(row.burn), 0);

  return (
    <AdminDexShell
      title="Overview"
      subtitle="Venue state from the exchange's own tables. Every figure is a live aggregate, not a cached snapshot."
    >
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat label="Pools" value={pools.loading ? '—' : `${activePools.length} / ${pools.data?.pools.length ?? 0}`} href="/admin/dex/pools" />
        <Stat label="Farms" value={farms.loading ? '—' : `${activeFarms.length} / ${farms.data?.farms.length ?? 0}`} href="/admin/dex/farms" />
        <Stat label="Gauges" value={farms.loading ? '—' : formatNumber(farms.data?.gauges.length ?? 0, 0)} href="/admin/dex/farms" />
        <Stat label="Lending markets" value={margin.loading ? '—' : `${activeMarkets.length} / ${margin.data?.markets.length ?? 0}`} href="/admin/dex/margin" />
        <Stat label="Blocked users" value={users.loading ? '—' : formatNumber(blockedUsers.length, 0)} href="/admin/dex/users" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Revenue by source">
          {revenue.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading revenue…</p>}
          {revenue.error && <p className="text-sm text-red-600 dark:text-red-400">{revenue.error}</p>}
          {!revenue.loading && revenueRows.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">No revenue has been recorded yet.</p>
          )}
          {revenueRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-gray-500 dark:text-slate-400">
                    <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Source</th>
                    <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Asset</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Total</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Treasury</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Insurance</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Burn</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueRows.map((row) => (
                    <tr key={`${row.source}-${row.asset}`}>
                      <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{row.source}</td>
                      <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{row.asset}</td>
                      <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(row.total)}</td>
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

        <div className="grid gap-3">
          <Stat label="Total recorded revenue" value={formatAmount(totalRevenue)} />
          <Stat label="Treasury share" value={formatAmount(totalTreasury)} />
          <Stat label="Insurance share" value={formatAmount(totalInsurance)} />
          <Stat label="Burn share" value={formatAmount(totalBurn)} />
        </div>
      </div>
    </AdminDexShell>
  );
}
