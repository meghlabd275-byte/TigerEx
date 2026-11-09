'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Loader2 } from 'lucide-react';
import { DexShell, Panel } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatPercent, shortenId } from '@/lib/dex/format';

interface PoolsResponse {
  pools: Array<{ poolId: string; tokens: string[]; fee: number; status: string }>;
}

interface Quote {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut: number;
  amountOutMin: number;
  priceImpact: number;
  executionPrice: number;
  fee: number;
  slippage: number;
  split: boolean;
  routes: number;
  hops: Array<{ poolId: string; tokenIn: string; tokenOut: string; amountIn: number; amountOut: number; fee: number }>;
}

export default function DexSwapPage() {
  const pools = useApiResource<PoolsResponse>('/api/dex/pools');
  const tokens = useMemo(() => {
    const set = new Set<string>();
    for (const pool of pools.data?.pools ?? []) {
      if (pool.status !== 'active') continue;
      for (const token of pool.tokens) set.add(token);
    }
    return Array.from(set).sort();
  }, [pools.data]);

  const [tokenIn, setTokenIn] = useState('');
  const [tokenOut, setTokenOut] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const [slippageBps, setSlippageBps] = useState('50');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (tokens.length === 0) return;
    setTokenIn((current) => (current && tokens.includes(current) ? current : tokens[0]));
    setTokenOut((current) =>
      current && tokens.includes(current) && current !== tokens[0] ? current : tokens.find((t) => t !== tokens[0]) ?? '',
    );
  }, [tokens]);

  const requestQuote = useCallback(async () => {
    const amount = Number(amountIn);
    if (!tokenIn || !tokenOut || tokenIn === tokenOut || !Number.isFinite(amount) || amount <= 0) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        tokenIn,
        tokenOut,
        amountIn: String(amount),
        slippage: String(Number(slippageBps) / 10_000),
      });
      const body = await apiRequest<{ quote: Quote }>(`/api/dex/swap?${params.toString()}`);
      setQuote(body.quote);
    } catch (error) {
      setQuote(null);
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not quote the swap.' });
    } finally {
      setQuoting(false);
    }
  }, [tokenIn, tokenOut, amountIn, slippageBps]);

  useEffect(() => {
    const handle = setTimeout(requestQuote, 300);
    return () => clearTimeout(handle);
  }, [requestQuote]);

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setQuote(null);
  };

  const swap = async () => {
    const amount = Number(amountIn);
    if (!quote || !Number.isFinite(amount) || amount <= 0) return;
    setSwapping(true);
    setMessage(null);
    try {
      const body = await apiRequest<{ swap: { swapId: string; amountOut: number; amountIn: number } }>(
        '/api/dex/swap',
        {
          method: 'POST',
          body: { tokenIn, tokenOut, amountIn: amount, slippage: Number(slippageBps) / 10_000 },
        },
      );
      setMessage({
        ok: true,
        text: `Swapped ${formatAmount(body.swap.amountIn)} ${tokenIn} for ${formatAmount(body.swap.amountOut)} ${tokenOut} (${shortenId(body.swap.swapId)}).`,
      });
      setAmountIn('');
      setQuote(null);
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The swap was refused.' });
    } finally {
      setSwapping(false);
    }
  };

  const disabled = !quote || swapping || tokenIn === tokenOut || tokens.length < 2;

  return (
    <DexShell title="Swap" subtitle="Trade through TigerSwap's own pools and router; the venue quotes and settles the trade itself.">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Trade" className="lg:col-span-1">
          {pools.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading pools…</p>}
          {!pools.loading && tokens.length < 2 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              At least one active pool with two tokens is needed before a swap can be made.
            </p>
          )}

          <label className="mt-2 block text-xs text-gray-500 dark:text-slate-400">From</label>
          <div className="mb-2 flex gap-2">
            <select
              className="w-40 rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={tokenIn}
              onChange={(event) => setTokenIn(event.target.value)}
            >
              {tokens.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
            <input
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              type="number"
              min="0"
              placeholder="0.0"
              value={amountIn}
              onChange={(event) => setAmountIn(event.target.value)}
            />
          </div>

          <div className="my-2 flex justify-center">
            <button
              type="button"
              onClick={flip}
              aria-label="Swap the two tokens"
              className="rounded-full border border-gray-300 p-2 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <ArrowDownUp className="h-4 w-4" />
            </button>
          </div>

          <label className="block text-xs text-gray-500 dark:text-slate-400">To</label>
          <div className="mb-3 flex gap-2">
            <select
              className="w-40 rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={tokenOut}
              onChange={(event) => setTokenOut(event.target.value)}
            >
              {tokens
                .filter((token) => token !== tokenIn)
                .map((token) => (
                  <option key={token} value={token}>
                    {token}
                  </option>
                ))}
            </select>
            <input
              className="flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
              readOnly
              value={quote ? formatAmount(quote.amountOut) : ''}
              placeholder="—"
            />
          </div>

          <label className="block text-xs text-gray-500 dark:text-slate-400">Slippage tolerance (basis points)</label>
          <input
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="number"
            min="0"
            value={slippageBps}
            onChange={(event) => setSlippageBps(event.target.value)}
          />

          <button
            onClick={swap}
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {swapping && <Loader2 className="h-4 w-4 animate-spin" />}
            {swapping ? 'Swapping…' : 'Swap'}
          </button>

          {message && (
            <p
              className={`mt-3 text-sm ${
                message.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {message.text}
            </p>
          )}
        </Panel>

        <Panel title="Quote" className="lg:col-span-2">
          {quoting && <p className="text-sm text-gray-500 dark:text-slate-400">Quoting…</p>}
          {!quoting && !quote && (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Enter an amount to see the route, the execution price and the price impact.
            </p>
          )}
          {quote && (
            <div className="space-y-2 text-sm">
              <Row label="Execution price" value={`${formatAmount(quote.executionPrice, 8)} ${tokenOut} per ${tokenIn}`} />
              <Row label="Minimum received" value={`${formatAmount(quote.amountOutMin)} ${tokenOut}`} />
              <Row label="Price impact" value={formatPercent(quote.priceImpact)} />
              <Row label="Swap fee" value={`${formatAmount(quote.fee)} ${tokenIn}`} />
              <Row label="Route" value={quote.split ? `split across ${quote.routes} routes` : `${quote.routes} route`} />
              <div className="pt-2">
                <p className="mb-1 text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Hops</p>
                <ul className="space-y-1">
                  {quote.hops.map((hop, index) => (
                    <li key={`${hop.poolId}-${index}`} className="text-gray-700 dark:text-slate-300">
                      {hop.tokenIn} → {hop.tokenOut} via {shortenId(hop.poolId)} ·{' '}
                      {formatAmount(hop.amountIn)} in / {formatAmount(hop.amountOut)} out
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </DexShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-gray-900 dark:text-slate-100">{value}</span>
    </div>
  );
}
