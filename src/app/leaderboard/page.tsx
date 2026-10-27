'use client';

import React, { useMemo, useState } from 'react';
import { Trophy, RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface LeaderboardTrader {
  rank?: number;
  user_id?: string;
  username?: string;
  nickname?: string;
  avatar?: string;
  roi?: number;
  pnl?: number;
  trades?: number;
  win_rate?: number;
}

function displayName(trader: LeaderboardTrader): string {
  return trader.nickname || trader.username || trader.user_id || 'Anonymous';
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function formatPercent(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState('all');
  const [type, setType] = useState('traders');

  const query = `/api/leaderboard/traders?type=${encodeURIComponent(
    type
  )}&period=${encodeURIComponent(period)}&limit=100`;
  const leaderboard = useApiResource<unknown>(query);
  const traders = useMemo(() => toArray<LeaderboardTrader>(leaderboard.data), [leaderboard.data]);

  const topThree = traders.slice(0, 3);
  const rest = traders.slice(3);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trophy className="w-8 h-8 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Leaderboard</h1>
          <p className="text-gray-400">Top traders on TigerEx</p>
          <button
            onClick={leaderboard.reload}
            className="mt-3 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6 flex-wrap">
          <div className="flex gap-2">
            {['all', '24h', '7d', '30d'].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm capitalize ${
                  period === p ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
                }`}
              >
                {p === 'all' ? 'All Time' : p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {['traders', 'copiers', 'pool'].map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-4 py-2 rounded-lg text-sm capitalize ${
                  type === t ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {leaderboard.loading && <p className="text-sm text-gray-500">Loading leaderboard…</p>}
        {leaderboard.error && (
          <p className="text-sm text-red-400">Could not load leaderboard: {leaderboard.error}</p>
        )}
        {!leaderboard.loading && !leaderboard.error && traders.length === 0 && (
          <div className="bg-[#14141A] rounded-xl p-8 text-center text-gray-500">
            No ranked traders for this period yet.
          </div>
        )}

        {/* Top 3 */}
        {topThree.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            {topThree.map((trader, i) => {
              const name = displayName(trader);
              return (
                <div
                  key={trader.user_id ?? name}
                  className={`bg-[#14141A] rounded-xl p-4 text-center ${
                    i === 0 ? 'order-2 -mt-4' : i === 1 ? 'order-1' : 'order-3'
                  }`}
                >
                  <div className="relative inline-block mb-2">
                    <div
                      className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${
                        i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-orange-700'
                      }`}
                    >
                      {trader.avatar || initials(name)}
                    </div>
                    <span className="absolute -top-1 -right-1 text-2xl">
                      {['🥇', '🥈', '🥉'][i]}
                    </span>
                  </div>
                  <p className="font-bold truncate">{name}</p>
                  <p className="text-green-500 text-sm">{formatPercent(trader.roi)}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {(trader.trades ?? 0).toLocaleString()} trades
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Leaderboard List */}
        {rest.length > 0 && (
          <div className="bg-[#14141A] rounded-xl overflow-hidden">
            <div className="grid grid-cols-6 gap-4 p-4 border-b border-[rgba(255,255,255,0.1)] text-sm text-gray-400">
              <div>Rank</div>
              <div>Trader</div>
              <div className="text-right">ROI</div>
              <div className="text-right">Trades</div>
              <div className="text-right">Win Rate</div>
              <div className="text-right">P&amp;L</div>
            </div>
            {rest.map((trader, index) => {
              const name = displayName(trader);
              const rank = trader.rank ?? index + 4;
              return (
                <div
                  key={trader.user_id ?? `${rank}-${name}`}
                  className="grid grid-cols-6 gap-4 p-4 border-b border-[rgba(255,255,255,0.05)] hover:bg-[#1E1E24] items-center"
                >
                  <div className="font-bold">#{rank}</div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-[#FF6B35]/20 flex items-center justify-center text-sm">
                      {trader.avatar || initials(name)}
                    </div>
                    <span className="font-medium truncate">{name}</span>
                  </div>
                  <div className="text-right text-green-500">{formatPercent(trader.roi)}</div>
                  <div className="text-right text-gray-400">
                    {(trader.trades ?? 0).toLocaleString()}
                  </div>
                  <div className="text-right text-gray-400">
                    {trader.win_rate === undefined ? '—' : `${trader.win_rate.toFixed(1)}%`}
                  </div>
                  <div className="text-right text-gray-400">
                    {trader.pnl === undefined ? '—' : trader.pnl.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
