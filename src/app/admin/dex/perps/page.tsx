'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';
import { formatAmount, formatNumber, formatPercent } from '@/lib/dex/format';

interface PerpsResponse {
  markets: Array<{
    symbol: string;
    base_asset: string;
    settlement_asset: string;
    max_leverage: number;
    funding_rate_cap: number;
    maintenance_margin_rate: number;
    status: string;
    openPositions: number;
    openInterest: number;
    markPrice: number | null;
  }>;
}

export default function AdminDexPerpsPage() {
  const perps = useApiResource<PerpsResponse>('/api/admin/dex/perps');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [positionId, setPositionId] = useState('');

  const markets = perps.data?.markets ?? [];

  const applyFunding = async (symbol: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ total: number }>('/api/admin/dex/perps', {
        method: 'POST',
        body: { action: 'funding', symbol, rate: Number(rateDraft[symbol]) },
      });
      setMessage({ ok: true, text: `Funding applied to ${symbol}; ${formatAmount(body.total)} transferred across positions.` });
      perps.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not apply funding.' });
    } finally {
      setBusy(false);
    }
  };

  const liquidate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/perps', { method: 'POST', body: { action: 'liquidate', positionId } });
      setMessage({ ok: true, text: `Position ${positionId} liquidated.` });
      setPositionId('');
      perps.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not liquidate the position.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Perpetual risk"
      subtitle="Listing and delisting of perpetual contracts is done in the futures admin console. This page covers funding and force-liquidation."
    >
      <AdminMessage message={message} />

      <div className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
        To list, edit, pause or delist a perpetual contract, use{' '}
        <Link href="/admin/futures" className="font-medium underline">
          Futures markets
        </Link>
        . TigerSwap settles against the same rows.
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Force liquidation">
          <Field label="Position id" value={positionId} onChange={setPositionId} placeholder="position id" />
          <button
            onClick={liquidate}
            disabled={busy || !positionId}
            className="mt-2 w-full rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            Liquidate at mark price
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Markets and open interest">
            {perps.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading markets…</p>}
            {perps.error && <p className="text-sm text-red-600 dark:text-red-400">{perps.error}</p>}
            {!perps.loading && markets.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                No perpetual market is listed. List one from the futures admin console.
              </p>
            )}
            {markets.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Symbol</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Mark</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Max lev.</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Open interest</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Positions</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Funding cap</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Apply funding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {markets.map((market) => (
                      <tr key={market.symbol}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                          {market.symbol}
                          <span className="ml-1 text-xs text-gray-400">{market.status}</span>
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          {market.markPrice === null ? '—' : formatNumber(market.markPrice, 4)}
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{market.max_leverage}x</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(market.openInterest)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{market.openPositions}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatPercent(market.funding_rate_cap)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                              placeholder="rate"
                              value={rateDraft[market.symbol] ?? ''}
                              onChange={(event) => setRateDraft((current) => ({ ...current, [market.symbol]: event.target.value }))}
                            />
                            <button
                              onClick={() => applyFunding(market.symbol)}
                              disabled={busy || rateDraft[market.symbol] === undefined || rateDraft[market.symbol] === ''}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                            >
                              Apply
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </AdminDexShell>
  );
}
