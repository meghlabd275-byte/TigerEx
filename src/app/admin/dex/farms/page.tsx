'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';
import { formatAmount, formatNumber, formatPercent, shortenId } from '@/lib/dex/format';

interface PoolsResponse {
  pools: Array<{ poolId: string; tokens: string[]; status: string }>;
}

interface FarmsResponse {
  farms: Array<{
    farm_id: string;
    name: string;
    pool_id: string;
    reward_token: string;
    reward_rate: number;
    apr: number;
    total_staked: number;
    boost_multiplier: number;
    status: string;
  }>;
  gauges: Array<{ gauge_id: string; pool_id: string; weight: number; emission_bps: number; status: string }>;
  bribes: Array<{ bribe_id: string; gauge_id: string; token: string; amount: number; sponsor: string; epoch: number }>;
}

const EMPTY = {
  name: '',
  poolId: '',
  rewardToken: 'TGR',
  rewardRate: '1',
  boostMultiplier: '1',
  startAt: '',
  endAt: '',
};

export default function AdminDexFarmsPage() {
  const farms = useApiResource<FarmsResponse>('/api/admin/dex/farms');
  const pools = useApiResource<PoolsResponse>('/api/admin/dex/pools');
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [aprDraft, setAprDraft] = useState<Record<string, string>>({});

  const farmRows = farms.data?.farms ?? [];
  const gauges = farms.data?.gauges ?? [];
  const bribes = farms.data?.bribes ?? [];

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ farmId: string }>('/api/admin/dex/farms', {
        method: 'POST',
        body: {
          name: form.name,
          poolId: form.poolId || pools.data?.pools[0]?.poolId,
          rewardToken: form.rewardToken,
          rewardRate: Number(form.rewardRate),
          boostMultiplier: Number(form.boostMultiplier),
          startAt: form.startAt || undefined,
          endAt: form.endAt || undefined,
        },
      });
      setMessage({ ok: true, text: `Farm ${shortenId(body.farmId)} created.` });
      setForm({ ...EMPTY });
      farms.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the farm.' });
    } finally {
      setBusy(false);
    }
  };

  const setApr = async (farmId: string) => {
    const apr = Number(aprDraft[farmId]);
    if (!Number.isFinite(apr) || apr < 0) {
      setMessage({ ok: false, text: 'Enter a non-negative APR.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/farms', { method: 'PUT', body: { farmId, apr } });
      setMessage({ ok: true, text: 'APR updated.' });
      farms.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the APR.' });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (farmId: string, status: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/farms', { method: 'PUT', body: { farmId, status } });
      setMessage({ ok: true, text: `Farm set to ${status}.` });
      farms.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the farm status.' });
    } finally {
      setBusy(false);
    }
  };

  const end = async (farmId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/dex/farms?farmId=${encodeURIComponent(farmId)}`, { method: 'DELETE' });
      setMessage({ ok: true, text: 'Farm ended.' });
      farms.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not end the farm.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Farms, gauges and emissions"
      subtitle="A farm binds a pool to a reward token. Creating a farm also creates the gauge that receives the epoch's emission."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Create a farm">
          <Field label="Name" value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
          <label className="block text-xs text-gray-500 dark:text-slate-400">Pool</label>
          <select
            className="mb-2 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={form.poolId}
            onChange={(event) => setForm((f) => ({ ...f, poolId: event.target.value }))}
          >
            {(pools.data?.pools ?? []).map((pool) => (
              <option key={pool.poolId} value={pool.poolId}>
                {pool.tokens.join(' / ')} · {shortenId(pool.poolId)}
              </option>
            ))}
          </select>
          <Field label="Reward token" value={form.rewardToken} onChange={(value) => setForm((f) => ({ ...f, rewardToken: value.toUpperCase() }))} />
          <Field label="Reward rate (per second)" type="number" value={form.rewardRate} onChange={(value) => setForm((f) => ({ ...f, rewardRate: value }))} />
          <Field label="Boost multiplier (1–10)" type="number" value={form.boostMultiplier} onChange={(value) => setForm((f) => ({ ...f, boostMultiplier: value }))} />
          <Field label="Start (optional, ISO date)" value={form.startAt} onChange={(value) => setForm((f) => ({ ...f, startAt: value }))} />
          <Field label="End (optional, ISO date)" value={form.endAt} onChange={(value) => setForm((f) => ({ ...f, endAt: value }))} />
          <button
            onClick={create}
            disabled={busy || !form.name || (pools.data?.pools.length ?? 0) === 0}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create farm
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Farms">
            {farms.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading farms…</p>}
            {farms.error && <p className="text-sm text-red-600 dark:text-red-400">{farms.error}</p>}
            {!farms.loading && farmRows.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">No farm exists.</p>
            )}
            {farmRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Farm</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Reward</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Rate</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">APR</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Staked</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Status</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {farmRows.map((farm) => (
                      <tr key={farm.farm_id}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                          {farm.name}
                          <span className="ml-1 text-xs text-gray-400">{shortenId(farm.pool_id)}</span>
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{farm.reward_token}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(farm.reward_rate)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatNumber(farm.apr, 2)}%</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(farm.total_staked)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{farm.status}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <div className="flex flex-wrap justify-end gap-1">
                            <input
                              className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                              placeholder="APR %"
                              value={aprDraft[farm.farm_id] ?? ''}
                              onChange={(event) => setAprDraft((current) => ({ ...current, [farm.farm_id]: event.target.value }))}
                            />
                            <button onClick={() => setApr(farm.farm_id)} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                              Set APR
                            </button>
                            {farm.status === 'active' ? (
                              <button onClick={() => setStatus(farm.farm_id, 'paused')} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                                Pause
                              </button>
                            ) : (
                              <button onClick={() => setStatus(farm.farm_id, 'active')} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                                Activate
                              </button>
                            )}
                            <button onClick={() => end(farm.farm_id)} disabled={busy || farm.status === 'ended'} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                              End
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Gauges">
          {gauges.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No gauge exists.</p>}
          {gauges.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-gray-500 dark:text-slate-400">
                    <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Gauge</th>
                    <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Pool</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Weight</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Emission</th>
                  </tr>
                </thead>
                <tbody>
                  {gauges.map((gauge) => (
                    <tr key={gauge.gauge_id}>
                      <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{shortenId(gauge.gauge_id)}</td>
                      <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{shortenId(gauge.pool_id)}</td>
                      <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatNumber(gauge.weight, 4)}</td>
                      <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatPercent(gauge.emission_bps / 10_000)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Bribes">
          {bribes.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No bribe has been submitted.</p>}
          {bribes.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-gray-500 dark:text-slate-400">
                    <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Gauge</th>
                    <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Token</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Amount</th>
                    <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Epoch</th>
                  </tr>
                </thead>
                <tbody>
                  {bribes.map((bribe) => (
                    <tr key={bribe.bribe_id}>
                      <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{shortenId(bribe.gauge_id)}</td>
                      <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{bribe.token}</td>
                      <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(bribe.amount)}</td>
                      <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{bribe.epoch}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AdminDexShell>
  );
}
