'use client';

import { useApiResource } from '@/lib/useApiResource';

interface ExchangeStats {
  dailyVolume?: number;
  tradingPairs?: number;
  totalUsers?: number;
  trades24h?: number;
}

function unwrap(payload: unknown): ExchangeStats | null {
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as Record<string, unknown>).data as ExchangeStats;
  }
  return (payload as ExchangeStats) ?? null;
}

function compact(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * Live exchange statistics for the landing page.
 *
 * Values come from `/api/stats`, which aggregates TigerEx's own database. While
 * the request is in flight the figures show as unavailable rather than a
 * decorative number, so the page never advertises volume that was not traded.
 */
export default function LiveStats() {
  const { data, loading } = useApiResource<unknown>('/api/stats');
  const stats = unwrap(data);

  const cells = [
    { value: loading ? '—' : compact(stats?.dailyVolume), label: 'Daily Volume' },
    {
      value: loading ? '—' : stats?.tradingPairs !== undefined ? String(stats.tradingPairs) : '—',
      label: 'Trading Pairs',
    },
    {
      value: loading ? '—' : stats?.trades24h !== undefined ? stats.trades24h.toLocaleString() : '—',
      label: 'Trades (24h)',
    },
    {
      value: loading ? '—' : stats?.totalUsers !== undefined ? stats.totalUsers.toLocaleString() : '—',
      label: 'Registered Users',
    },
  ];

  return (
    <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8">
      {cells.map((cell) => (
        <div key={cell.label} className="text-center">
          <div className="text-3xl font-bold text-white">{cell.value}</div>
          <div className="text-sm text-gray-400">{cell.label}</div>
        </div>
      ))}
    </div>
  );
}
