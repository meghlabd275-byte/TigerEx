'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { formatUsd, formatNumber, pairLabel, formatPercent } from '@/lib/dex/format';

interface Overview {
  dex: {
    activePools: number;
    totalTvlUsd: number;
    swaps24h: number;
    volume24hUsd: number;
    fees24hUsd: number;
    listedTokens: number;
  };
}

interface PoolsResponse {
  pools: Array<{
    poolId: string;
    kind: string;
    tokens: string[];
    fee: number;
    tvlUsd: number | null;
    volume24hUsd: number | null;
    fee24hUsd: number | null;
    status: string;
  }>;
}

interface Analytics {
  overview: {
    totalPools: number;
    totalTvlUsd: number;
    swaps24h: number;
    volume24hUsd: number;
    fees24hUsd: number;
    activeSwappers: number;
    openPerpPositions: number;
    totalSupplied: number;
    totalBorrowed: number;
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

export default function DexOverviewPage() {
  const overview = useApiResource<Overview>('/api/dex');
  const analytics = useApiResource<Analytics>('/api/dex/analytics');
  const pools = useApiResource<PoolsResponse>('/api/dex/pools');

  const rows = useMemo(() => pools.data?.pools ?? [], [pools.data]);
  const dex = overview.data?.dex ?? null;
  const agg = analytics.data?.overview ?? null;

  const reloadAll = () => {
    overview.reload();
    analytics.reload();
    pools.reload();
  };

  return (
    <DexShell
      title="TigerSwap overview"
      subtitle="Live venue state, aggregated from TigerSwap's own pools, swaps and revenue ledger."
      actions={
        <button
          onClick={reloadAll}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      }
    >
      {overview.error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {overview.error}
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Active pools" value={dex ? formatNumber(dex.activePools, 0) : '—'} />
        <Stat label="Total TVL" value={dex ? formatUsd(dex.totalTvlUsd) : '—'} />
        <Stat label="24h volume" value={dex ? formatUsd(dex.volume24hUsd) : '—'} />
        <Stat label="24h fees" value={dex ? formatUsd(dex.fees24hUsd) : '—'} />
        <Stat label="24h swaps" value={dex ? formatNumber(dex.swaps24h, 0) : '—'} />
        <Stat label="Listed tokens" value={dex ? formatNumber(dex.listedTokens, 0) : '—'} />
      </div>

      {agg && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Active swappers" value={formatNumber(agg.activeSwappers, 0)} />
          <Stat label="Open perp positions" value={formatNumber(agg.openPerpPositions, 0)} />
          <Stat label="Margin supplied" value={formatUsd(agg.totalSupplied)} />
        </div>
      )}

      <Panel title="Pools">
        {pools.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading pools…</p>}
        {pools.error && <p className="text-sm text-red-600 dark:text-red-400">{pools.error}</p>}
        {!pools.loading && !pools.error && rows.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No pool has been created yet. An administrator creates pools from the DEX admin console.
          </p>
        )}
        {rows.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Pair</Th>
                <Th>Type</Th>
                <Th right>Fee</Th>
                <Th right>TVL</Th>
                <Th right>24h volume</Th>
                <Th right>24h fees</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pool) => (
                <tr key={pool.poolId}>
                  <Td>{pairLabel(pool.tokens)}</Td>
                  <Td className="uppercase">{pool.kind}</Td>
                  <Td right>{formatPercent(pool.fee)}</Td>
                  <Td right>{formatUsd(pool.tvlUsd)}</Td>
                  <Td right>{formatUsd(pool.volume24hUsd)}</Td>
                  <Td right>{formatUsd(pool.fee24hUsd)}</Td>
                  <Td>{pool.status}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
