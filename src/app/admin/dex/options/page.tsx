'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';
import { formatAmount, formatNumber, formatPercent, shortenId } from '@/lib/dex/format';

interface OptionsResponse {
  pools: Array<{
    poolId: string;
    underlying: string;
    settlementAsset: string;
    collateral: number;
    reserved: number;
    freeCollateral: number;
    feeBps: number;
    volatility: number;
    riskFreeRate: number;
    status: string;
  }>;
}

const EMPTY = {
  underlying: '',
  settlementAsset: 'RUSD',
  volatility: '0.5',
  riskFreeRate: '0',
  feeBps: '50',
  collateral: '0',
};

export default function AdminDexOptionsPage() {
  const pools = useApiResource<OptionsResponse>('/api/admin/dex/options');
  const [form, setForm] = useState({ ...EMPTY });
  const [fundDraft, setFundDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = pools.data?.pools ?? [];

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ pool: { poolId: string } }>('/api/admin/dex/options', {
        method: 'POST',
        body: {
          underlying: form.underlying,
          settlementAsset: form.settlementAsset,
          volatility: Number(form.volatility),
          riskFreeRate: Number(form.riskFreeRate),
          feeBps: Number(form.feeBps),
          collateral: Number(form.collateral),
        },
      });
      setMessage({ ok: true, text: `Option pool ${shortenId(body.pool.poolId)} created.` });
      setForm({ ...EMPTY });
      pools.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the option pool.' });
    } finally {
      setBusy(false);
    }
  };

  const fund = async (poolId: string) => {
    const amount = Number(fundDraft[poolId]);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ ok: false, text: 'Enter a positive amount to fund.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/options', { method: 'PUT', body: { poolId, amount } });
      setMessage({ ok: true, text: `Moved ${formatAmount(amount)} of treasury collateral into the pool.` });
      setFundDraft((current) => ({ ...current, [poolId]: '' }));
      pools.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not fund the option pool.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Options pools"
      subtitle="Each pool writes cash-settled calls and puts against one underlying and reserves each contract's worst-case payout. Funding the pool from the treasury is what raises its writing capacity."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Create an options pool">
          <Field label="Underlying" value={form.underlying} onChange={(value) => setForm((f) => ({ ...f, underlying: value.toUpperCase() }))} />
          <Field label="Settlement asset" value={form.settlementAsset} onChange={(value) => setForm((f) => ({ ...f, settlementAsset: value.toUpperCase() }))} />
          <Field label="Volatility (fraction)" type="number" value={form.volatility} onChange={(value) => setForm((f) => ({ ...f, volatility: value }))} />
          <Field label="Risk-free rate (fraction)" type="number" value={form.riskFreeRate} onChange={(value) => setForm((f) => ({ ...f, riskFreeRate: value }))} />
          <Field label="Fee (bps, <10000)" type="number" value={form.feeBps} onChange={(value) => setForm((f) => ({ ...f, feeBps: value }))} />
          <Field label="Seed collateral" type="number" value={form.collateral} onChange={(value) => setForm((f) => ({ ...f, collateral: value }))} />
          <button
            onClick={create}
            disabled={busy || !form.underlying}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create pool
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Options pools">
            {pools.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading pools…</p>}
            {pools.error && <p className="text-sm text-red-600 dark:text-red-400">{pools.error}</p>}
            {!pools.loading && rows.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">No option pool exists.</p>
            )}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Underlying</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Collateral</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Reserved</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Free</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Fee</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Vol</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Fund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((pool) => (
                      <tr key={pool.poolId}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                          {pool.underlying}/{pool.settlementAsset}
                          <span className="ml-1 text-xs text-gray-400">{shortenId(pool.poolId)}</span>
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(pool.collateral)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(pool.reserved)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(pool.freeCollateral)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatNumber(pool.feeBps / 100, 2)}%</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatPercent(pool.volatility)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <div className="flex justify-end gap-1">
                            <input
                              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                              placeholder="Amount"
                              value={fundDraft[pool.poolId] ?? ''}
                              onChange={(event) => setFundDraft((current) => ({ ...current, [pool.poolId]: event.target.value }))}
                            />
                            <button
                              onClick={() => fund(pool.poolId)}
                              disabled={busy}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                            >
                              Fund
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
