'use client';

import { useState } from 'react';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { AdminDexShell, AdminMessage, Card, Field } from '@/components/dex/AdminDexShell';
import { formatAmount, formatPercent, pairLabel, shortenId } from '@/lib/dex/format';

type PoolKind = 'v2' | 'v3' | 'stable' | 'weighted';

interface PoolsResponse {
  pools: Array<{
    poolId: string;
    kind: PoolKind;
    address: string;
    tokens: string[];
    fee: number;
    amplification: number | null;
    weights: number[] | null;
    tickSpacing: number | null;
    sqrtPrice: number | null;
    reserves: Record<string, number>;
    totalSupply: number;
    tvlUsd: number | null;
    status: string;
  }>;
}

const EMPTY = {
  kind: 'v2' as PoolKind,
  tokens: 'RUSD,ETH',
  feePercent: '0.3',
  amplification: '100',
  weights: '0.8,0.2',
  tickSpacing: '60',
  sqrtPrice: '44.7',
  sqrtPriceLower: '30',
  sqrtPriceUpper: '60',
  reserves: '1000000,500',
};

export default function AdminDexPoolsPage() {
  const pools = useApiResource<PoolsResponse>('/api/admin/dex/pools');
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [feeDraft, setFeeDraft] = useState<Record<string, string>>({});

  const rows = pools.data?.pools ?? [];
  const tokenList = form.tokens
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);

  const buildBody = () => {
    const reserves: Record<string, number> = {};
    form.reserves
      .split(',')
      .map((value) => value.trim())
      .forEach((value, index) => {
        if (tokenList[index]) reserves[tokenList[index]] = Number(value);
      });
    const body: Record<string, unknown> = {
      kind: form.kind,
      tokens: tokenList,
      fee: Number(form.feePercent) / 100,
      reserves,
    };
    if (form.kind === 'stable') body.amplification = Number(form.amplification);
    if (form.kind === 'weighted') {
      body.weights = form.weights
        .split(',')
        .map((value) => Number(value.trim()));
    }
    if (form.kind === 'v3') {
      body.tickSpacing = Number(form.tickSpacing);
      body.sqrtPrice = Number(form.sqrtPrice);
      body.sqrtPriceLower = Number(form.sqrtPriceLower);
      body.sqrtPriceUpper = Number(form.sqrtPriceUpper);
    }
    return body;
  };

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ poolId: string }>('/api/admin/dex/pools', { method: 'POST', body: buildBody() });
      setMessage({ ok: true, text: `Pool ${shortenId(body.poolId)} created.` });
      pools.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not create the pool.' });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (poolId: string, status: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/pools', { method: 'PUT', body: { poolId, status } });
      setMessage({ ok: true, text: `Pool set to ${status}.` });
      pools.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the pool status.' });
    } finally {
      setBusy(false);
    }
  };

  const setFee = async (poolId: string) => {
    const percent = Number(feeDraft[poolId]);
    if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
      setMessage({ ok: false, text: 'Enter a fee percentage between 0 and 100.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest('/api/admin/dex/pools', { method: 'PUT', body: { poolId, fee: percent / 100 } });
      setMessage({ ok: true, text: 'Fee updated.' });
      pools.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not change the fee.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (poolId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await apiRequest(`/api/admin/dex/pools?poolId=${encodeURIComponent(poolId)}`, { method: 'DELETE' });
      setMessage({ ok: true, text: 'Pool delisted.' });
      pools.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not delist the pool.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDexShell
      title="Pools"
      subtitle="Create a pool of any kind and manage its fee and status. The pool's reserves seed its initial liquidity."
    >
      <AdminMessage message={message} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Create a pool">
          <label className="block text-xs text-gray-500 dark:text-slate-400">Kind</label>
          <select
            className="mb-2 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={form.kind}
            onChange={(event) => setForm((f) => ({ ...f, kind: event.target.value as PoolKind }))}
          >
            <option value="v2">V2 constant product</option>
            <option value="v3">V3 concentrated</option>
            <option value="stable">Stable</option>
            <option value="weighted">Weighted</option>
          </select>
          <Field label="Tokens (comma separated, in reserve order)" value={form.tokens} onChange={(value) => setForm((f) => ({ ...f, tokens: value }))} />
          <Field label="Fee (%)" type="number" value={form.feePercent} onChange={(value) => setForm((f) => ({ ...f, feePercent: value }))} />
          <Field
            label={`Initial reserves (comma separated, order: ${tokenList.join(', ') || '—'})`}
            value={form.reserves}
            onChange={(value) => setForm((f) => ({ ...f, reserves: value }))}
          />
          {form.kind === 'stable' && (
            <Field label="Amplification (A)" type="number" value={form.amplification} onChange={(value) => setForm((f) => ({ ...f, amplification: value }))} />
          )}
          {form.kind === 'weighted' && (
            <Field label="Weights (comma separated, must sum to 1)" value={form.weights} onChange={(value) => setForm((f) => ({ ...f, weights: value }))} />
          )}
          {form.kind === 'v3' && (
            <>
              <Field label="Tick spacing" type="number" value={form.tickSpacing} onChange={(value) => setForm((f) => ({ ...f, tickSpacing: value }))} />
              <Field label="Sqrt price" type="number" value={form.sqrtPrice} onChange={(value) => setForm((f) => ({ ...f, sqrtPrice: value }))} />
              <Field label="Sqrt price lower" type="number" value={form.sqrtPriceLower} onChange={(value) => setForm((f) => ({ ...f, sqrtPriceLower: value }))} />
              <Field label="Sqrt price upper" type="number" value={form.sqrtPriceUpper} onChange={(value) => setForm((f) => ({ ...f, sqrtPriceUpper: value }))} />
            </>
          )}
          <button
            onClick={create}
            disabled={busy || tokenList.length < 2}
            className="mt-2 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Create pool
          </button>
        </Card>

        <div className="lg:col-span-2">
          <Card title="Pools">
            {pools.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading pools…</p>}
            {pools.error && <p className="text-sm text-red-600 dark:text-red-400">{pools.error}</p>}
            {!pools.loading && rows.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">No pool exists.</p>
            )}
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-gray-500 dark:text-slate-400">
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Pool</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Kind</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Fee</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Reserves</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">TVL</th>
                      <th className="border-b border-gray-200 px-2 py-1 dark:border-slate-800">Status</th>
                      <th className="border-b border-gray-200 px-2 py-1 text-right dark:border-slate-800">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((pool) => (
                      <tr key={pool.poolId}>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">
                          {pairLabel(pool.tokens)}
                          <span className="ml-1 text-xs text-gray-400">{shortenId(pool.poolId)}</span>
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 uppercase dark:border-slate-800/60">{pool.kind}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatPercent(pool.fee)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          {pool.tokens
                            .map((token) => `${formatAmount(pool.reserves[token])} ${token}`)
                            .join(' / ')}
                        </td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">{formatAmount(pool.tvlUsd)}</td>
                        <td className="border-b border-gray-100 px-2 py-1 dark:border-slate-800/60">{pool.status}</td>
                        <td className="border-b border-gray-100 px-2 py-1 text-right dark:border-slate-800/60">
                          <div className="flex flex-wrap justify-end gap-1">
                            {pool.status !== 'active' ? (
                              <button onClick={() => setStatus(pool.poolId, 'active')} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                                Activate
                              </button>
                            ) : (
                              <button onClick={() => setStatus(pool.poolId, 'paused')} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                                Pause
                              </button>
                            )}
                            <input
                              className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                              placeholder="fee %"
                              value={feeDraft[pool.poolId] ?? ''}
                              onChange={(event) => setFeeDraft((current) => ({ ...current, [pool.poolId]: event.target.value }))}
                            />
                            <button onClick={() => setFee(pool.poolId)} disabled={busy} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                              Set fee
                            </button>
                            <button onClick={() => remove(pool.poolId)} disabled={busy || pool.status === 'delisted'} className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-slate-700">
                              Delist
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
