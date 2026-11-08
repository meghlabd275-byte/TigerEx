'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';
import { readAuthToken } from '@/lib/auth/token';

interface OptionContract {
  symbol: string;
  underlying: string;
  settlementAsset: string;
  optionType: 'call' | 'put';
  strikePrice: number;
  expiryNs: number;
  exerciseStyle: string;
  minQuantity: number;
  status: string;
}

interface ContractQuote {
  symbol: string;
  optionType: 'call' | 'put';
  strike: number;
  spot: number;
  mark: number;
  volatility: number;
  timeToExpiryYears: number;
  greeks: { delta: number; gamma: number; vega: number; theta: number };
}

interface OptionsPosition {
  positionId: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  status: string;
}

function fmt(value: number | undefined | null, digits = 6): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function expiryLabel(expiryNs: number): string {
  if (!Number.isFinite(expiryNs)) return '—';
  return new Date(expiryNs / 1e6).toLocaleString();
}

export default function OptionsPage() {
  const contracts = useApiResource<unknown>('/api/options/contracts');
  const [quotes, setQuotes] = useState<Record<string, ContractQuote>>({});
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [positions, setPositions] = useState<OptionsPosition[] | null>(null);
  const [positionsError, setPositionsError] = useState<string | null>(null);

  const contractList = useMemo(() => toArray<OptionContract>(contracts.data), [contracts.data]);

  const loadQuotes = useCallback(async () => {
    const entries = await Promise.all(
      contractList.map(async (contract) => {
        try {
          const response = await fetch(`/api/options/price?symbol=${encodeURIComponent(contract.symbol)}`, {
            cache: 'no-store',
          });
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            return [contract.symbol, null, body?.error?.message ?? `status ${response.status}`] as const;
          }
          return [contract.symbol, body?.quote as ContractQuote, null] as const;
        } catch (err: unknown) {
          return [contract.symbol, null, err instanceof Error ? err.message : 'Request failed'] as const;
        }
      }),
    );

    const nextQuotes: Record<string, ContractQuote> = {};
    const nextErrors: Record<string, string> = {};
    for (const [symbol, quote, error] of entries) {
      if (quote) nextQuotes[symbol] = quote;
      if (error) nextErrors[symbol] = error;
    }
    setQuotes(nextQuotes);
    setQuoteErrors(nextErrors);
  }, [contractList]);

  const loadPositions = useCallback(async () => {
    const token = readAuthToken();
    if (!token) {
      setPositions(null);
      setPositionsError(null);
      return;
    }
    try {
      const response = await fetch('/api/options/position', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
      setPositions(Array.isArray(body?.positions) ? body.positions : []);
      setPositionsError(null);
    } catch (err: unknown) {
      setPositions(null);
      setPositionsError(err instanceof Error ? err.message : 'Positions could not be loaded');
    }
  }, []);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  useEffect(() => {
    if (contractList.length) void loadQuotes();
  }, [contractList, loadQuotes]);

  return (
    <main className="min-h-screen bg-[#0A0A0F] p-4 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Options</h1>
            <p className="text-gray-400">Premiums are the venue&apos;s own Black-Scholes mark for each listed contract.</p>
          </div>
          <button
            onClick={() => {
              contracts.reload();
              void loadQuotes();
              void loadPositions();
            }}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        <section className="mb-6 rounded-xl bg-[#14141A] p-5">
          <h2 className="mb-3 text-lg font-semibold">Your positions</h2>
          {!readAuthToken() && <p className="text-sm text-gray-500">Sign in to see your options positions.</p>}
          {positionsError && <p className="text-sm text-red-400">{positionsError}</p>}
          {positions && positions.length === 0 && <p className="text-sm text-gray-500">You have no open options positions.</p>}
          {positions && positions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="pb-2">Contract</th>
                    <th className="pb-2">Side</th>
                    <th className="pb-2 text-right">Quantity</th>
                    <th className="pb-2 text-right">Entry</th>
                    <th className="pb-2 text-right">Mark</th>
                    <th className="pb-2 text-right">Unrealized P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.positionId} className="border-t border-white/5">
                      <td className="py-2">{position.symbol}</td>
                      <td className={`py-2 capitalize ${position.side === 'long' ? 'text-green-400' : 'text-red-400'}`}>
                        {position.side}
                      </td>
                      <td className="py-2 text-right">{fmt(position.quantity, 4)}</td>
                      <td className="py-2 text-right">{fmt(position.entryPrice)}</td>
                      <td className="py-2 text-right">{fmt(position.markPrice)}</td>
                      <td className={`py-2 text-right ${position.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {fmt(position.unrealizedPnl, 4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Options chain</h2>
          {contracts.loading && <p className="text-sm text-gray-500">Loading contracts…</p>}
          {contracts.error && <p className="text-sm text-red-400">Could not load contracts: {contracts.error}</p>}
          {!contracts.loading && !contracts.error && contractList.length === 0 && (
            <p className="text-sm text-gray-500">No options contracts are listed yet.</p>
          )}
          {contractList.length > 0 && (
            <div className="overflow-x-auto rounded-xl bg-[#14141A] p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="pb-2">Contract</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2 text-right">Strike</th>
                    <th className="pb-2 text-right">Spot</th>
                    <th className="pb-2 text-right">Mark</th>
                    <th className="pb-2 text-right">IV</th>
                    <th className="pb-2 text-right">Delta</th>
                    <th className="pb-2">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {contractList.map((contract) => {
                    const quote = quotes[contract.symbol];
                    const error = quoteErrors[contract.symbol];
                    return (
                      <tr key={contract.symbol} className="border-t border-white/5">
                        <td className="py-2">{contract.symbol}</td>
                        <td className={`py-2 uppercase ${contract.optionType === 'call' ? 'text-green-400' : 'text-red-400'}`}>
                          {contract.optionType}
                        </td>
                        <td className="py-2 text-right">{fmt(contract.strikePrice)}</td>
                        <td className="py-2 text-right">{quote ? fmt(quote.spot) : '—'}</td>
                        <td className="py-2 text-right">
                          {error ? <span className="text-red-400" title={error}>unavailable</span> : quote ? fmt(quote.mark) : '…'}
                        </td>
                        <td className="py-2 text-right">{quote ? `${(quote.volatility * 100).toFixed(1)}%` : '—'}</td>
                        <td className="py-2 text-right">{quote ? fmt(quote.greeks.delta, 4) : '—'}</td>
                        <td className="py-2 text-xs text-gray-400">{expiryLabel(contract.expiryNs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
