'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';
import { readAuthToken } from '@/lib/auth/token';

interface MarginMarket {
  symbol: string;
  mode: string;
  baseAsset: string;
  quoteAsset: string;
  maxLeverage: number;
  collateralLtv: string | Record<string, number>;
  borrowableAssets: string | string[];
  riskTier: string;
  status: string;
}

interface MarginLoan {
  loanId: string;
  symbol: string;
  mode: string;
  asset: string;
  principal: number;
  interestAccrued: number;
  totalOwed: number;
  collateralAsset: string;
  collateralAmount: number;
  collateralValue: number;
  ltv: number;
  healthRatio: number;
  liquidatable: boolean;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function fmt(value: number | undefined | null, digits = 4): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function MarginPage() {
  const markets = useApiResource<unknown>('/api/margin/markets');
  const [account, setAccount] = useState<{ loans: MarginLoan[]; totalCollateralValue: number; totalDebt: number; healthRatio: number } | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const marketList = useMemo(() => toArray<MarginMarket>(markets.data), [markets.data]);

  const loadAccount = useCallback(async () => {
    const token = readAuthToken();
    if (!token) {
      setAccount(null);
      setAccountError(null);
      return;
    }
    try {
      const response = await fetch('/api/margin/account', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
      setAccount({
        loans: Array.isArray(body?.loans) ? body.loans : [],
        totalCollateralValue: Number(body?.totalCollateralValue) || 0,
        totalDebt: Number(body?.totalDebt) || 0,
        healthRatio: Number(body?.healthRatio) || 0,
      });
      setAccountError(null);
    } catch (err: unknown) {
      setAccount(null);
      setAccountError(err instanceof Error ? err.message : 'The margin account could not be loaded');
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount, reloadKey]);

  return (
    <main className="min-h-screen bg-[#0A0A0F] p-4 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Margin</h1>
            <p className="text-gray-400">Borrow against collateral on the exchange&apos;s listed pools.</p>
          </div>
          <button
            onClick={() => {
              markets.reload();
              setReloadKey((n) => n + 1);
            }}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        <section className="mb-6 rounded-xl bg-[#14141A] p-5">
          <h2 className="mb-3 text-lg font-semibold">Your margin account</h2>
          {!readAuthToken() && <p className="text-sm text-gray-500">Sign in to see your margin account.</p>}
          {accountError && <p className="text-sm text-red-400">{accountError}</p>}
          {account && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Collateral value</p>
                  <p className="text-lg font-semibold">{fmt(account.totalCollateralValue, 2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total debt</p>
                  <p className="text-lg font-semibold">{fmt(account.totalDebt, 2)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Health ratio</p>
                  <p className="text-lg font-semibold">{Number.isFinite(account.healthRatio) ? fmt(account.healthRatio, 4) : '∞'}</p>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                {account.loans.length === 0 ? (
                  <p className="text-sm text-gray-500">You have no open margin loans.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500">
                        <th className="pb-2">Market</th>
                        <th className="pb-2">Mode</th>
                        <th className="pb-2">Borrowed</th>
                        <th className="pb-2 text-right">Owed</th>
                        <th className="pb-2 text-right">LTV</th>
                        <th className="pb-2 text-right">Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.loans.map((loan) => (
                        <tr key={loan.loanId} className="border-t border-white/5">
                          <td className="py-2">{loan.symbol}</td>
                          <td className="py-2 capitalize">{loan.mode}</td>
                          <td className="py-2">{fmt(loan.principal)} {loan.asset}</td>
                          <td className="py-2 text-right">{fmt(loan.totalOwed)} {loan.asset}</td>
                          <td className={`py-2 text-right ${loan.liquidatable ? 'text-red-400' : ''}`}>{fmt(loan.ltv, 4)}</td>
                          <td className={`py-2 text-right ${loan.liquidatable ? 'text-red-400' : 'text-green-400'}`}>
                            {Number.isFinite(loan.healthRatio) ? fmt(loan.healthRatio, 4) : '∞'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Listed margin pools</h2>
          {markets.loading && <p className="text-sm text-gray-500">Loading pools…</p>}
          {markets.error && <p className="text-sm text-red-400">Could not load pools: {markets.error}</p>}
          {!markets.loading && !markets.error && marketList.length === 0 && (
            <p className="text-sm text-gray-500">No margin pools are listed yet.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {marketList.map((market) => {
              const ltv = parseJson<Record<string, number>>(market.collateralLtv, {});
              const borrowable = parseJson<string[]>(market.borrowableAssets, []);
              return (
                <div key={`${market.symbol}-${market.mode}`} className="rounded-xl bg-[#14141A] p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{market.symbol}</p>
                    <span className="rounded bg-[#FF6B35]/20 px-2 py-0.5 text-xs capitalize text-[#FF6B35]">
                      {market.mode}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Up to {market.maxLeverage}x · {market.riskTier} risk
                  </p>
                  <p className="mt-2 text-xs text-gray-400">
                    Collateral LTV: {Object.entries(ltv).map(([asset, value]) => `${asset} ${(value * 100).toFixed(0)}%`).join(', ') || '—'}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    Borrowable: {borrowable.length ? borrowable.join(', ') : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
