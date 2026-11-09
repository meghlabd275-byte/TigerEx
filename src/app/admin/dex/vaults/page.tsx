'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';
import { formatAmount, formatNumber, shortenId } from '@/lib/dex/format';

interface VaultsResponse {
  vaults: Array<{
    vaultId: string;
    name: string;
    kind: string;
    poolId: string;
    stakedToken: string;
    rewardToken: string;
    totalAssets: number;
    totalSupply: number;
    sharePrice: number;
    performanceFeeBps: number;
    minHarvest: number;
    status: string;
  }>;
}

interface PoolsResponse {
  pools: Array<{ poolId: string; tokens: string[]; status: string }>;
}

const EMPTY = {
  name: '',
  kind: 'lp',
  poolId: '',
  stakedToken: 'TGR',
  rewardToken: 'RYUSD',
  performanceFeeBps: '1000',
  minHarvest: '0',
};

export default function AdminDexVaultsPage() {
  const vaults = useApiResource<VaultsResponse>('/api/admin/dex/vaults');
  const pools = useApiResource<PoolsResponse>('/api/admin/dex/pools');
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [harvestDraft, setHarvestDraft] = useState<Record<string, { reward: string; added: string }>>({});

  const rows = vaults.data?.vaults ?? [];

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ vaultId: string }>('/api/admin/dex/vaults', {
        method: 'POST',
        body: {
          name: form.name,
          kind: form.kind,
          poolId: form.poolId || pools.data?.pools[0]?.poolId,
          stakedToken: form.stakedToken,
          rewardToken: form.rewardToken,
          performanceFeeBps: Number(form.performanceFeeBps),
          minHarvest: Number(form.minHarvest),
        },
      });
      setMessage({ ok: true, text: `Vault ${shortenId(body.vaultId)} created.` });
      setForm({ ...EMPTY });
      vaults.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the vault.' });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (vaultId: string, status: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/vaults', { method: 'PUT', body: { vaultId, status } });
      setMessage({ ok: true, text: `Vault set to ${status}.` });
      vaults.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the vault status.' });
    } finally {
      setBusy(false);
    }
  };

  const harvest = async (vaultId: string) => {
    const draft = harvestDraft[vaultId] ?? { reward: '', added: '' };
    const rewardAmount = Number(draft.reward);
    const assetsAdded = Number(draft.added);
    if (!Number.isFinite(rewardAmount) || !Number.isFinite(assetsAdded) || rewardAmount < 0 || assetsAdded < 0) {
      setMessage({ ok: false, text: 'Enter a non-negative reward and asset amount.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await apiRequest<{ harvest: { skipped: boolean; performanceFee: number } }>('/api/admin/dex/vaults', {
        method: 'PATCH',
        body: { vaultId, rewardAmount, assetsAdded },
      });
      setMessage({
        ok: true,
        text: result.harvest.skipped
          ? 'Harvest skipped: below the minimum.'
          : `Harvested; fee ${formatAmount(result.harvest.performanceFee)}.`,
      });
      vaults.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not harvest the vault.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Auto-compounding vaults"
      subtitle="A vault stakes LP tokens, sells the farm rewards back into the staked token and restakes them. Shares are priced against real assets, so a late depositor cannot claim earlier rewards."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Create a vault">
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
          <Field label="Staked token" value={form.stakedToken} onChange={(value) => setForm((f) => ({ ...f, stakedToken: value.toUpperCase() }))} />
          <Field label="Reward token" value={form.rewardToken} onChange={(value) => setForm((f) => ({ ...f, rewardToken: value.toUpperCase() }))} />
          <Field label="Performance fee (bps, <10000)" type="number" value={form.performanceFeeBps} onChange={(value) => setForm((f) => ({ ...f, performanceFeeBps: value }))} />
          <Field label="Minimum harvest" type="number" value={form.minHarvest} onChange={(value) => setForm((f) => ({ ...f, minHarvest: value }))} />
          <button
            onClick={create}
            disabled={busy || !form.name || (pools.data?.pools.length ?? 0) === 0}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create vault
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Vaults">
            {vaults.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading vaults…</p>}
            {vaults.error && <p className="text-sm text-red-600 dark:text-red-400">{vaults.error}</p>}
            {!vaults.loading && rows.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No vault exists.</p>}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Vault</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Assets</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Shares</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Share price</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Fee</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Status</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((vault) => (
                      <tr key={vault.vaultId}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                          {vault.name}
                          <span className="ml-1 text-xs text-gray-400">{shortenId(vault.poolId)}</span>
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(vault.totalAssets)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(vault.totalSupply)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatNumber(vault.sharePrice, 6)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatNumber(vault.performanceFeeBps / 100, 2)}%</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{vault.status}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <div className="flex flex-wrap justify-end gap-1">
                            <input
                              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                              placeholder="Reward"
                              value={harvestDraft[vault.vaultId]?.reward ?? ''}
                              onChange={(event) =>
                                setHarvestDraft((current) => ({
                                  ...current,
                                  [vault.vaultId]: { reward: event.target.value, added: current[vault.vaultId]?.added ?? '' },
                                }))
                              }
                            />
                            <input
                              className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                              placeholder="Assets"
                              value={harvestDraft[vault.vaultId]?.added ?? ''}
                              onChange={(event) =>
                                setHarvestDraft((current) => ({
                                  ...current,
                                  [vault.vaultId]: { reward: current[vault.vaultId]?.reward ?? '', added: event.target.value },
                                }))
                              }
                            />
                            <button onClick={() => harvest(vault.vaultId)} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                              Harvest
                            </button>
                            {vault.status === 'active' ? (
                              <button onClick={() => setStatus(vault.vaultId, 'paused')} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                                Pause
                              </button>
                            ) : (
                              <button onClick={() => setStatus(vault.vaultId, 'active')} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
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
