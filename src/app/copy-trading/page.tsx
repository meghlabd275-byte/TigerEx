'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';
import { readAuthToken } from '@/lib/auth/token';

interface CopyTrader {
  traderId: string;
  displayName: string;
  markets: string[];
  roi7d: number;
  roi30d: number;
  roi90d: number;
  winRate: number;
  trades: number;
  followers: number;
  maxFollowers: number;
  aum: number;
  profitShare: number;
  status: string;
}

interface CopyFollow {
  followId: string;
  traderId: string;
  leaderName: string;
  mode: string;
  fixedAmount: number | null;
  ratio: number | null;
  maxPosition: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  status: string;
  createdAt: string;
}

function pct(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function num(value: number | undefined | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function CopyTradingPage() {
  const traders = useApiResource<unknown>('/api/copy/traders?sortBy=profit&limit=100');
  const [following, setFollowing] = useState<CopyFollow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const traderList = useMemo(() => toArray<CopyTrader>(traders.data), [traders.data]);

  const loadFollowing = useCallback(async () => {
    const token = readAuthToken();
    if (!token) {
      setFollowing(null);
      return;
    }
    try {
      const response = await fetch('/api/copy/following', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
      setFollowing(Array.isArray(body?.following) ? body.following : []);
    } catch (err: unknown) {
      setFollowing(null);
      setNotice(err instanceof Error ? err.message : 'Follows could not be loaded');
    }
  }, []);

  useEffect(() => {
    void loadFollowing();
  }, [loadFollowing]);

  async function follow(traderId: string) {
    const token = readAuthToken();
    if (!token) {
      setNotice('Sign in to copy a trader.');
      return;
    }
    const amount = window.prompt('Copy amount in quote currency (minimum 100):', '100');
    if (amount === null) return;
    const fixedAmount = Number(amount);
    if (!Number.isFinite(fixedAmount) || fixedAmount < 100) {
      setNotice('A copy amount of at least 100 is required.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/copy/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ traderId, mode: 'fixed', amount: fixedAmount }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
      setNotice('Now copying this trader.');
      await loadFollowing();
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : 'The follow could not be created');
    } finally {
      setBusy(false);
    }
  }

  async function stop(followId: string) {
    const token = readAuthToken();
    if (!token) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/copy/follow', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ followId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
      setNotice('Stopped copying.');
      await loadFollowing();
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : 'The follow could not be stopped');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0A0A0F] p-4 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Copy Trading</h1>
            <p className="text-gray-400">
              Performance is recomputed from each leader&apos;s settled trades on this venue.
            </p>
          </div>
          <button
            onClick={() => {
              traders.reload();
              void loadFollowing();
            }}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {notice && <div className="mb-4 rounded-lg bg-[#FF6B35]/10 px-4 py-2 text-sm text-[#FF6B35]">{notice}</div>}

        {following && following.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-lg font-semibold">Traders you copy</h2>
            <div className="grid gap-3">
              {following.map((entry) => (
                <div key={entry.followId} className="flex items-center justify-between rounded-xl bg-[#14141A] p-4">
                  <div>
                    <p className="font-medium">{entry.leaderName || entry.traderId}</p>
                    <p className="text-xs text-gray-500">
                      {entry.mode} · {entry.fixedAmount !== null ? `fixed ${num(entry.fixedAmount)}` : `ratio ${entry.ratio ?? '—'}`} · {entry.status}
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => stop(entry.followId)}
                    className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                  >
                    Stop
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <TrendingUp className="h-5 w-5 text-[#FF6B35]" /> Leaders
          </h2>
          {traders.loading && <p className="text-sm text-gray-500">Loading leaders…</p>}
          {traders.error && <p className="text-sm text-red-400">Could not load leaders: {traders.error}</p>}
          {!traders.loading && !traders.error && traderList.length === 0 && (
            <p className="text-sm text-gray-500">No copy-trading leaders have been approved yet.</p>
          )}
          {traderList.length > 0 && (
            <div className="overflow-x-auto rounded-xl bg-[#14141A] p-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500">
                    <th className="pb-2">Leader</th>
                    <th className="pb-2">Markets</th>
                    <th className="pb-2 text-right">ROI 30d</th>
                    <th className="pb-2 text-right">Win rate</th>
                    <th className="pb-2 text-right">Trades</th>
                    <th className="pb-2 text-right">Followers</th>
                    <th className="pb-2 text-right">AUM</th>
                    <th className="pb-2 text-right">Profit share</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {traderList.map((trader) => (
                    <tr key={trader.traderId} className="border-t border-white/5">
                      <td className="py-2">{trader.displayName || trader.traderId}</td>
                      <td className="py-2 text-xs text-gray-400">{trader.markets.join(', ') || '—'}</td>
                      <td className={`py-2 text-right ${trader.roi30d >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {pct(trader.roi30d)}
                      </td>
                      <td className="py-2 text-right">{pct(trader.winRate)}</td>
                      <td className="py-2 text-right">{trader.trades}</td>
                      <td className="py-2 text-right">{trader.followers}/{trader.maxFollowers}</td>
                      <td className="py-2 text-right">{num(trader.aum)}</td>
                      <td className="py-2 text-right">{pct(trader.profitShare)}</td>
                      <td className="py-2 text-right">
                        <button
                          disabled={busy || trader.followers >= trader.maxFollowers}
                          onClick={() => follow(trader.traderId)}
                          className="rounded-lg bg-[#FF6B35] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                        >
                          Copy
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
