'use client';

import { useMemo, useState } from 'react';
import { Loader2, RefreshCw, Plus, Minus } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatPercent, formatUsd, shortenId, pairLabel } from '@/lib/dex/format';

interface PoolsResponse {
  pools: Array<{
    poolId: string;
    kind: string;
    tokens: string[];
    fee: number;
    status: string;
    reserves: Record<string, number>;
    tvlUsd: number | null;
    volume24hUsd: number | null;
    feeApr: number | null;
    feeApy: number | null;
  }>;
}

interface PositionsResponse {
  positions: Array<{
    positionId: string;
    poolId: string;
    kind: string;
    tokens: string[];
    liquidity: number;
    share: number;
    amount0: number;
    amount1: number;
    valueUsd: number;
    fees24hUsd: number;
    feeApr: number | null;
    feeApy: number | null;
    divergenceLoss: number | null;
    lockedUntil: string | null;
  }>;
}

export default function DexLiquidityPage() {
  const pools = useApiResource<PoolsResponse>('/api/dex/pools');
  const positions = useApiResource<PositionsResponse>('/api/dex/liquidity');

  const activePools = useMemo(
    () => (pools.data?.pools ?? []).filter((pool) => pool.status === 'active'),
    [pools.data],
  );

  const [poolId, setPoolId] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [lockDays, setLockDays] = useState('0');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = activePools.find((pool) => pool.poolId === poolId) ?? activePools[0] ?? null;

  const add = async () => {
    if (!selected) return;
    const parsed: Record<string, number> = {};
    for (const token of selected.tokens) {
      const value = Number(amounts[token]);
      if (!Number.isFinite(value) || value <= 0) {
        setMessage({ ok: false, text: `Enter a positive amount for ${token}.` });
        return;
      }
      parsed[token] = value;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ position: { liquidity: number } }>('/api/dex/liquidity', {
        method: 'POST',
        body: {
          poolId: selected.poolId,
          amounts: parsed,
          lockedUntil: Number(lockDays) > 0 ? new Date(Date.now() + Number(lockDays) * 86400000).toISOString() : undefined,
        },
      });
      setMessage({ ok: true, text: `Added liquidity; minted ${formatAmount(body.position.liquidity)} LP tokens.` });
      setAmounts({});
      positions.reload();
      pools.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not add liquidity.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (position: PositionsResponse['positions'][number]) => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ removed: { amount0: number; amount1: number } }>('/api/dex/liquidity', {
        method: 'DELETE',
        body: { poolId: position.poolId, liquidity: position.liquidity },
      });
      setMessage({
        ok: true,
        text: `Removed liquidity; received ${formatAmount(body.removed.amount0)} ${position.tokens[0]} and ${formatAmount(body.removed.amount1)} ${position.tokens[1] ?? ''}.`,
      });
      positions.reload();
      pools.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not remove liquidity.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DexShell
      title="Liquidity"
      subtitle="Provide liquidity to a TigerSwap pool and earn its swap fees."
      actions={
        <button
          onClick={() => {
            positions.reload();
            pools.reload();
          }}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      }
    >
      {message && (
        <p
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            message.ok
              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Add liquidity">
          {activePools.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">No active pool is available.</p>
          ) : (
            <>
              <label className="block text-xs text-gray-500 dark:text-slate-400">Pool</label>
              <select
                className="mb-3 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={selected?.poolId ?? ''}
                onChange={(event) => {
                  setPoolId(event.target.value);
                  setAmounts({});
                }}
              >
                {activePools.map((pool) => (
                  <option key={pool.poolId} value={pool.poolId}>
                    {pairLabel(pool.tokens)} · {pool.kind} · {formatPercent(pool.fee)}
                  </option>
                ))}
              </select>

              {selected?.tokens.map((token) => (
                <div key={token} className="mb-2">
                  <label className="block text-xs text-gray-500 dark:text-slate-400">{token} amount</label>
                  <input
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    type="number"
                    min="0"
                    value={amounts[token] ?? ''}
                    onChange={(event) => setAmounts((current) => ({ ...current, [token]: event.target.value }))}
                  />
                </div>
              ))}

              <label className="block text-xs text-gray-500 dark:text-slate-400">Lock for (days, 0 for none)</label>
              <input
                className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={lockDays}
                onChange={(event) => setLockDays(event.target.value)}
              />

              <button
                onClick={add}
                disabled={busy || !selected}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add liquidity
              </button>
            </>
          )}
        </Panel>

        <Panel title="Your positions" className="lg:col-span-2">
          {positions.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading positions…</p>}
          {positions.error && <p className="text-sm text-red-600 dark:text-red-400">{positions.error}</p>}
          {!positions.loading && (positions.data?.positions ?? []).length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">You have no liquidity position yet.</p>
          )}
          {(positions.data?.positions ?? []).length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Pool</Th>
                  <Th right>Share</Th>
                  <Th right>Underlying</Th>
                  <Th right>Value</Th>
                  <Th right>Fees 24h</Th>
                  <Th right>APR / APY</Th>
                  <Th right>IL</Th>
                  <Th>Locked until</Th>
                  <Th right>Action</Th>
                </tr>
              </thead>
              <tbody>
                {(positions.data?.positions ?? []).map((position) => {
                  const locked = position.lockedUntil ? new Date(position.lockedUntil).getTime() > Date.now() : false;
                  return (
                    <tr key={position.positionId}>
                      <Td>
                        {pairLabel(position.tokens)}
                        <span className="ml-2 text-xs text-gray-400">{shortenId(position.poolId)}</span>
                      </Td>
                      <Td right>{formatPercent(position.share)}</Td>
                      <Td right>
                        {formatAmount(position.amount0)} {position.tokens[0]}
                        {position.tokens[1] ? ` / ${formatAmount(position.amount1)} ${position.tokens[1]}` : ''}
                      </Td>
                      <Td right>{formatUsd(position.valueUsd)}</Td>
                      <Td right>{formatUsd(position.fees24hUsd)}</Td>
                      <Td right>
                        {formatPercent(position.feeApr)} / {formatPercent(position.feeApy)}
                      </Td>
                      <Td right>
                        {position.divergenceLoss === null ? '—' : formatPercent(position.divergenceLoss)}
                      </Td>
                      <Td>{position.lockedUntil ? new Date(position.lockedUntil).toLocaleString() : 'Not locked'}</Td>
                      <Td right>
                        <button
                          onClick={() => remove(position)}
                          disabled={busy || locked}
                          title={locked ? 'This position is locked until its maturity' : 'Remove liquidity'}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Minus className="h-3 w-3" /> Remove
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </DexShell>
  );
}
