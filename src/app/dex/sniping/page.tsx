'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, formatPercent, shortenId } from '@/lib/dex/format';

interface Candidate {
  poolId: string;
  createdAt: number;
  liquidityIn: number;
  tradingEnabled: boolean;
  flagged: boolean;
  rank: number;
  score: number;
}

interface ScanResponse {
  policy: { windowSeconds: number; minLiquidity: number; maxImpact: number; gasMultiplier: number };
  candidates: Candidate[];
}

interface SnipeQuote {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  expectedOut: number;
  minOut: number;
  impact: number;
  gasMultiplier: number;
}

export default function DexSnipingPage() {
  const [tokenIn, setTokenIn] = useState('RUSD');
  const [tokenOut, setTokenOut] = useState('TGR');
  const [amountIn, setAmountIn] = useState('1000');
  const [quote, setQuote] = useState<SnipeQuote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const scan = useApiResource<ScanResponse>(`/api/dex/sniping?tokenIn=${encodeURIComponent(tokenIn)}`);

  const run = async (kind: 'quote' | 'execute') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'quote') {
        const params = new URLSearchParams({ tokenIn, tokenOut, amountIn, poolId: scan.data?.candidates[0]?.poolId ?? '' });
        const result = await apiRequest<{ quote: SnipeQuote }>(`/api/dex/sniping?${params.toString()}`);
        setQuote(result.quote);
      } else {
        const poolId = scan.data?.candidates[0]?.poolId;
        if (!poolId) throw new Error('No eligible pool is available to snipe.');
        const result = await apiRequest<{ snipe: { amountOut: number } }>('/api/dex/sniping', {
          method: 'POST',
          body: { poolId, tokenIn, tokenOut, amountIn: Number(amountIn) },
        });
        setMessage({ ok: true, text: `Snipe settled; received ${formatAmount(result.snipe.amountOut)} ${tokenOut}.` });
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The request was refused.' });
    } finally {
      setBusy(null);
    }
  };

  const candidates = scan.data?.candidates ?? [];

  return (
    <DexShell
      title="Sniping bot"
      subtitle="Buy a freshly created TigerSwap pool's token before its price finds a level. The size is capped by how much the snipe may move the price."
      actions={
        <button
          onClick={scan.reload}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" /> Rescan
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

      <Panel title="Snipe a pool" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-gray-500 dark:text-slate-400">Token in</span>
            <input
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={tokenIn}
              onChange={(event) => setTokenIn(event.target.value.toUpperCase())}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-500 dark:text-slate-400">Token out</span>
            <input
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={tokenOut}
              onChange={(event) => setTokenOut(event.target.value.toUpperCase())}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-500 dark:text-slate-400">Amount in</span>
            <input
              type="number"
              min="0"
              className="w-full rounded-md border border-gray-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              value={amountIn}
              onChange={(event) => setAmountIn(event.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              onClick={() => run('quote')}
              disabled={busy !== null || candidates.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {busy === 'quote' && <Loader2 className="h-4 w-4 animate-spin" />} Quote
            </button>
            <button
              onClick={() => run('execute')}
              disabled={busy !== null || candidates.length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-3 py-2 text-sm text-white hover:bg-orange-700 disabled:opacity-40"
            >
              {busy === 'execute' && <Loader2 className="h-4 w-4 animate-spin" />} Snipe
            </button>
          </div>
        </div>

        {quote && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Size</p>
              <p className="text-lg font-semibold">{formatAmount(quote.amountIn)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Expected out</p>
              <p className="text-lg font-semibold">{formatAmount(quote.expectedOut)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Min out</p>
              <p className="text-lg font-semibold">{formatAmount(quote.minOut)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-slate-400">Impact</p>
              <p className="text-lg font-semibold">{formatPercent(quote.impact)}</p>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Eligible pools">
        {scan.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Scanning pools…</p>}
        {scan.error && <p className="text-sm text-red-600 dark:text-red-400">{scan.error}</p>}
        {!scan.loading && candidates.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No pool holding {tokenIn} is inside the sniping window right now.
          </p>
        )}
        {candidates.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Rank</Th>
                <Th>Pool</Th>
                <Th right>Liquidity</Th>
                <Th right>Score</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.poolId}>
                  <Td right>{candidate.rank}</Td>
                  <Td>{shortenId(candidate.poolId)}</Td>
                  <Td right>{formatAmount(candidate.liquidityIn)}</Td>
                  <Td right>{formatNumber(candidate.score, 4)}</Td>
                  <Td>{candidate.tradingEnabled ? 'open' : 'paused'}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
