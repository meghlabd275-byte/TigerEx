'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';
import { formatAmount, formatNumber, shortenId } from '@/lib/dex/format';

interface StakingResponse {
  pools: Array<{
    stakeId: string;
    name: string;
    stakeToken: string;
    receiptToken: string;
    totalStaked: number;
    totalShares: number;
    exchangeRate: number;
    redemptionFeeBps: number;
    status: string;
  }>;
}

const EMPTY = {
  name: '',
  stakeToken: 'TGR',
  receiptToken: 'stTGR',
  redemptionFeeBps: '0',
};

export default function AdminDexLiquidStakingPage() {
  const staking = useApiResource<StakingResponse>('/api/admin/dex/liquid-staking');
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rewardDraft, setRewardDraft] = useState<Record<string, string>>({});

  const rows = staking.data?.pools ?? [];

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ stakeId: string }>('/api/admin/dex/liquid-staking', {
        method: 'POST',
        body: {
          name: form.name,
          stakeToken: form.stakeToken,
          receiptToken: form.receiptToken,
          redemptionFeeBps: Number(form.redemptionFeeBps),
        },
      });
      setMessage({ ok: true, text: `Staking pool ${shortenId(body.stakeId)} created.` });
      setForm({ ...EMPTY });
      staking.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the staking pool.' });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (stakeId: string, status: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/liquid-staking', { method: 'PUT', body: { stakeId, status } });
      setMessage({ ok: true, text: `Staking pool set to ${status}.` });
      staking.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the status.' });
    } finally {
      setBusy(false);
    }
  };

  const distribute = async (stakeId: string) => {
    const rewards = Number(rewardDraft[stakeId]);
    if (!Number.isFinite(rewards) || rewards <= 0) {
      setMessage({ ok: false, text: 'Enter a positive reward amount.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiRequest<{ distribution: { rate: number } }>('/api/admin/dex/liquid-staking', {
        method: 'PATCH',
        body: { stakeId, rewards },
      });
      setMessage({ ok: true, text: `Rewards distributed; the rate is now ${formatNumber(result.distribution.rate, 6)}.` });
      setRewardDraft((current) => ({ ...current, [stakeId]: '' }));
      staking.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not distribute the rewards.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Liquid staking (stTGR)"
      subtitle="Staking TGR mints stTGR at an exchange rate that rises as rewards are distributed. The rate is derived from the pool's real balances, so it can never drift from the ledger."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Create a staking pool">
          <Field label="Name" value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
          <Field label="Stake token" value={form.stakeToken} onChange={(value) => setForm((f) => ({ ...f, stakeToken: value.toUpperCase() }))} />
          <Field label="Receipt token" value={form.receiptToken} onChange={(value) => setForm((f) => ({ ...f, receiptToken: value.toUpperCase() }))} />
          <Field label="Redemption fee (bps, <10000)" type="number" value={form.redemptionFeeBps} onChange={(value) => setForm((f) => ({ ...f, redemptionFeeBps: value }))} />
          <button
            onClick={create}
            disabled={busy || !form.name || form.stakeToken === form.receiptToken}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create pool
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Staking pools">
            {staking.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading pools…</p>}
            {staking.error && <p className="text-sm text-red-600 dark:text-red-400">{staking.error}</p>}
            {!staking.loading && rows.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No staking pool exists.</p>}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Pool</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Staked</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Shares</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Rate</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Fee</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Status</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((pool) => (
                      <tr key={pool.stakeId}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                          {pool.name}
                          <span className="ml-1 text-xs text-gray-400">
                            {pool.stakeToken} → {pool.receiptToken}
                          </span>
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(pool.totalStaked)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(pool.totalShares)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatNumber(pool.exchangeRate, 6)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatNumber(pool.redemptionFeeBps / 100, 2)}%</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{pool.status}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <div className="flex flex-wrap justify-end gap-1">
                            <input
                              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                              placeholder="Rewards"
                              value={rewardDraft[pool.stakeId] ?? ''}
                              onChange={(event) => setRewardDraft((current) => ({ ...current, [pool.stakeId]: event.target.value }))}
                            />
                            <button onClick={() => distribute(pool.stakeId)} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                              Distribute
                            </button>
                            {pool.status === 'active' ? (
                              <button onClick={() => setStatus(pool.stakeId, 'paused')} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                                Pause
                              </button>
                            ) : (
                              <button onClick={() => setStatus(pool.stakeId, 'active')} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
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
