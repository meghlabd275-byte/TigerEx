'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';
import { formatAmount, formatPercent } from '@/lib/dex/format';

interface MarketsResponse {
  markets: Array<{
    marketId: string;
    asset: string;
    ltv: number;
    liquidationThreshold: number;
    liquidationBonus: number;
    totalSupply: number;
    totalBorrow: number;
    supplyCap: number;
    borrowCap: number;
    status: string;
    utilization: number;
    borrowRate: number;
    supplyRate: number;
  }>;
}

const EMPTY = {
  asset: '',
  ltvPercent: '70',
  liquidationThresholdPercent: '75',
  liquidationBonusPercent: '5',
  baseRatePercent: '5',
  kinkPercent: '80',
  jumpMultiplier: '100',
  supplyCap: '10000000',
  borrowCap: '8000000',
};

export default function AdminDexMarginPage() {
  const markets = useApiResource<MarketsResponse>('/api/admin/dex/margin');
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = markets.data?.markets ?? [];

  const payload = () => ({
    asset: form.asset,
    ltv: Number(form.ltvPercent) / 100,
    liquidationThreshold: Number(form.liquidationThresholdPercent) / 100,
    liquidationBonus: Number(form.liquidationBonusPercent) / 100,
    baseRate: Number(form.baseRatePercent) / 100,
    kink: Number(form.kinkPercent) / 100,
    jumpMultiplier: Number(form.jumpMultiplier),
    supplyCap: Number(form.supplyCap),
    borrowCap: Number(form.borrowCap),
  });

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/margin', { method: 'POST', body: payload() });
      setMessage({ ok: true, text: `${form.asset} lending market created.` });
      setForm({ ...EMPTY });
      markets.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the market.' });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (asset: string, status: 'active' | 'paused') => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/margin', { method: 'PUT', body: { asset, status } });
      setMessage({ ok: true, text: `${asset} set to ${status}.` });
      markets.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the market status.' });
    } finally {
      setBusy(false);
    }
  };

  const pause = async (asset: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/dex/margin?asset=${encodeURIComponent(asset)}`, { method: 'DELETE' });
      setMessage({ ok: true, text: `${asset} paused.` });
      markets.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not pause the market.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Margin and lending markets"
      subtitle="A lending market is the borrowable asset with its collateral schedule and interest model. An isolated pool is the same row with its own caps."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Create a lending market">
          <Field label="Asset" value={form.asset} onChange={(value) => setForm((f) => ({ ...f, asset: value.toUpperCase() }))} />
          <Field label="LTV (%)" type="number" value={form.ltvPercent} onChange={(value) => setForm((f) => ({ ...f, ltvPercent: value }))} />
          <Field
            label="Liquidation threshold (%)"
            type="number"
            value={form.liquidationThresholdPercent}
            onChange={(value) => setForm((f) => ({ ...f, liquidationThresholdPercent: value }))}
          />
          <Field
            label="Liquidation bonus (%)"
            type="number"
            value={form.liquidationBonusPercent}
            onChange={(value) => setForm((f) => ({ ...f, liquidationBonusPercent: value }))}
          />
          <Field label="Base rate (APR %)" type="number" value={form.baseRatePercent} onChange={(value) => setForm((f) => ({ ...f, baseRatePercent: value }))} />
          <Field label="Kink (%)" type="number" value={form.kinkPercent} onChange={(value) => setForm((f) => ({ ...f, kinkPercent: value }))} />
          <Field label="Jump multiplier" type="number" value={form.jumpMultiplier} onChange={(value) => setForm((f) => ({ ...f, jumpMultiplier: value }))} />
          <Field label="Supply cap" type="number" value={form.supplyCap} onChange={(value) => setForm((f) => ({ ...f, supplyCap: value }))} />
          <Field label="Borrow cap" type="number" value={form.borrowCap} onChange={(value) => setForm((f) => ({ ...f, borrowCap: value }))} />
          <button
            onClick={create}
            disabled={busy || !form.asset}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create market
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Markets">
            {markets.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading markets…</p>}
            {markets.error && <p className="text-sm text-red-600 dark:text-red-400">{markets.error}</p>}
            {!markets.loading && rows.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">No lending market exists.</p>
            )}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Asset</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">LTV</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Liq. threshold</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Supplied</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Borrowed</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Utilisation</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Status</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((market) => (
                      <tr key={market.marketId}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{market.asset}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatPercent(market.ltv)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatPercent(market.liquidationThreshold)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(market.totalSupply)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(market.totalBorrow)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatPercent(market.utilization)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{market.status}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <div className="flex justify-end gap-1">
                            {market.status === 'active' ? (
                              <button
                                onClick={() => pause(market.asset)}
                                disabled={busy}
                                title="Pausing is refused while a position still has supply or borrow"
                                className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                              >
                                Pause
                              </button>
                            ) : (
                              <button
                                onClick={() => setStatus(market.asset, 'active')}
                                disabled={busy}
                                className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700"
                              >
                                Activate
                              </button>
                            )}
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
