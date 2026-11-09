'use client';

import { useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, shortenId } from '@/lib/dex/format';

interface PoolsResponse {
  pools: Array<{ poolId: string; kind: string; tokens: string[]; fee: number; status: string; reserves: Record<string, number> }>;
}

interface PositionsResponse {
  positions: Array<{
    positionId: string;
    poolId: string;
    kind: string;
    tokens: string[];
    liquidity: number;
    amount0: number;
    amount1: number;
  }>;
}

export default function DexZapPage() {
  const pools = useApiResource<PoolsResponse>('/api/dex/pools');
  const positions = useApiResource<PositionsResponse>('/api/dex/liquidity');

  const zapPools = useMemo(
    () => (pools.data?.pools ?? []).filter((pool) => pool.status === 'active' && pool.tokens.length === 2),
    [pools.data],
  );

  const [poolId, setPoolId] = useState('');
  const [tokenIn, setTokenIn] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = zapPools.find((pool) => pool.poolId === poolId) ?? zapPools[0] ?? null;
  const inputToken = selected ? tokenIn || selected.tokens[0] : '';

  const zap = async () => {
    if (!selected) return;
    const value = Number(amountIn);
    if (!Number.isFinite(value) || value <= 0) {
      setMessage({ ok: false, text: 'Enter a positive amount to zap.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ zap: { liquidity: number; swappedOut: number } }>('/api/dex/zap', {
        method: 'POST',
        body: {
          poolId: selected.poolId,
          tokenIn: inputToken,
          amountIn: value,
          slippage: Number(slippage) / 100,
        },
      });
      setMessage({
        ok: true,
        text: `Zapped into liquidity ${formatAmount(body.zap.liquidity)} after swapping ${formatAmount(body.zap.swappedOut)}.`,
      });
      setAmountIn('');
      positions.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The zap was refused.' });
    } finally {
      setBusy(false);
    }
  };

  const zapOut = async (positionPoolId: string, tokenOut: string, liquidity: number) => {
    setBusy(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ zap: { received: number; tokenOut: string } }>('/api/dex/zap', {
        method: 'DELETE',
        body: { poolId: positionPoolId, liquidity, tokenOut, slippage: Number(slippage) / 100 },
      });
      setMessage({ ok: true, text: `Redeemed into ${formatAmount(body.zap.received)} ${body.zap.tokenOut}.` });
      positions.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The zap-out was refused.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DexShell
      title="Zap"
      subtitle="Add liquidity from a single token, or redeem a position into one token, in a single action."
      actions={
        <button
          onClick={() => {
            pools.reload();
            positions.reload();
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

      <Panel title="Zap in" className="mb-4">
        {zapPools.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">No two-token pool is available to zap into.</p>
        )}
        {zapPools.length > 0 && selected && (
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-gray-500 dark:text-slate-400">Pool</span>
              <select
                className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={selected.poolId}
                onChange={(event) => {
                  setPoolId(event.target.value);
                  setTokenIn('');
                }}
              >
                {zapPools.map((pool) => (
                  <option key={pool.poolId} value={pool.poolId}>
                    {pool.tokens.join(' / ')} · {shortenId(pool.poolId)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-gray-500 dark:text-slate-400">Deposit token</span>
              <select
                className="w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={inputToken}
                onChange={(event) => setTokenIn(event.target.value)}
              >
                {selected.tokens.map((token) => (
                  <option key={token} value={token}>
                    {token}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-gray-500 dark:text-slate-400">Amount</span>
              <input
                className="w-full rounded-md border border-gray-300 px-2 py-2 text-right text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={amountIn}
                onChange={(event) => setAmountIn(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-gray-500 dark:text-slate-400">Slippage %</span>
              <input
                className="w-full rounded-md border border-gray-300 px-2 py-2 text-right text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                type="number"
                min="0"
                value={slippage}
                onChange={(event) => setSlippage(event.target.value)}
              />
            </label>
            <div className="md:col-span-4">
              <button
                onClick={zap}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-40"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Zap in
              </button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Zap out">
        {!positions.loading && (positions.data?.positions ?? []).length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">You have no liquidity position to redeem.</p>
        )}
        {(positions.data?.positions ?? []).length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Pool</Th>
                <Th right>Liquidity</Th>
                <Th right>Amounts</Th>
                <Th right>Action</Th>
              </tr>
            </thead>
            <tbody>
              {(positions.data?.positions ?? []).map((position) => (
                <tr key={position.positionId}>
                  <Td>
                    {position.tokens.join(' / ')}
                    <span className="ml-2 text-xs text-gray-400">{shortenId(position.poolId)}</span>
                  </Td>
                  <Td right>{formatAmount(position.liquidity)}</Td>
                  <Td right>
                    {formatAmount(position.amount0)} / {formatAmount(position.amount1)}
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-2">
                      {position.tokens.map((token) => (
                        <button
                          key={token}
                          onClick={() => zapOut(position.poolId, token, position.liquidity)}
                          disabled={busy}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Into {token}
                        </button>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
