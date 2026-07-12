'use client';

import React, { useState } from 'react';
import { Trophy, TrendingUp, Users, ChevronDown, Medal } from 'lucide-react';

const LEADERBOARD = [
  { rank: 1, user: 'CryptoKing', avatar: 'CK', profit: '+1,234%', trades: 15420, winRate: '94%', badges: ['🥇', '🔥'] },
  { rank: 2, user: 'DeFiWhale', avatar: 'DW', profit: '+892%', trades: 12350, winRate: '89%', badges: ['🥈'] },
  { rank: 3, user: 'AltcoinHunter', avatar: 'AH', profit: '+756%', trades: 9870, winRate: '86%', badges: ['🥉'] },
  { rank: 4, user: 'SwingMaster', avatar: 'SM', profit: '+534%', trades: 8540, winRate: '91%', badges: [] },
  { rank: 5, user: 'MomentumKing', avatar: 'MK', profit: '+423%', trades: 6780, winRate: '84%', badges: [] },
  { rank: 6, user: 'GridTrader', avatar: 'GT', profit: '+398%', trades: 5430, winRate: '88%', badges: [] },
  { rank: 7, user: 'ScalpPro', avatar: 'SP', profit: '+345%', trades: 4320, winRate: '82%', badges: [] },
  { rank: 8, user: 'DCAExpert', avatar: 'DE', profit: '+312%', trades: 3890, winRate: '79%', badges: [] },
  { rank: 9, user: 'FuturesKing', avatar: 'FK', profit: '+289%', trades: 3450, winRate: '77%', badges: [] },
  { rank: 10, user: 'BotMaster', avatar: 'BM', profit: '+256%', trades: 2980, winRate: '81%', badges: [] },
];

const MY_RANK = { rank: 127, user: 'You', profit: '+45%', trades: 234, winRate: '68%' };

export default function LeaderboardPage() {
  const [period, setPeriod] = useState('all');
  const [type, setType] = useState('traders');

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trophy className="w-8 h-8 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Leaderboard</h1>
          <p className="text-gray-400">Top traders on TigerEx</p>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <div className="flex gap-2">
            {['all', '24h', '7d', '30d'].map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm capitalize ${period === p ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
                {p === 'all' ? 'All Time' : p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {['traders', 'copiers', 'pool'].map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-4 py-2 rounded-lg text-sm capitalize ${type === t ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Top 3 */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {LEADERBOARD.slice(0, 3).map((trader, i) => (
            <div key={trader.rank} className={`bg-[#14141A] rounded-xl p-4 text-center ${i === 0 ? 'order-2 -mt-4' : i === 1 ? 'order-1' : 'order-3'}`}>
              <div className="relative inline-block mb-2">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${
                  i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : 'bg-orange-700'
                }`}>
                  {trader.avatar}
                </div>
                <span className="absolute -top-1 -right-1 text-2xl">{['🥇', '🥈', '🥉'][i]}</span>
              </div>
              <p className="font-bold">{trader.user}</p>
              <p className="text-green-500 text-sm">{trader.profit}</p>
              <p className="text-xs text-gray-500 mt-2">{trader.trades.toLocaleString()} trades</p>
            </div>
          ))}
        </div>

        {/* Leaderboard List */}
        <div className="bg-[#14141A] rounded-xl overflow-hidden">
          <div className="grid grid-cols-6 gap-4 p-4 border-b border-[rgba(255,255,255,0.1)] text-sm text-gray-400">
            <div>Rank</div>
            <div>Trader</div>
            <div className="text-right">Profit</div>
            <div className="text-right">Trades</div>
            <div className="text-right">Win Rate</div>
            <div className="text-right">Badges</div>
          </div>
          {LEADERBOARD.map(trader => (
            <div key={trader.rank} className="grid grid-cols-6 gap-4 p-4 border-b border-[rgba(255,255,255,0.05)] hover:bg-[#1E1E24] items-center">
              <div className="font-bold">#{trader.rank}</div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#FF6B35]/20 flex items-center justify-center text-sm">
                  {trader.avatar}
                </div>
                <span className="font-medium">{trader.user}</span>
              </div>
              <div className="text-right text-green-500">{trader.profit}</div>
              <div className="text-right text-gray-400">{trader.trades.toLocaleString()}</div>
              <div className="text-right text-gray-400">{trader.winRate}</div>
              <div className="text-right">{trader.badges.join(' ')}</div>
            </div>
          ))}
        </div>

        {/* My Rank */}
        <div className="mt-6 bg-[#14141A] rounded-xl p-4">
          <div className="grid grid-cols-4 gap-4 items-center">
            <div className="font-bold">#{MY_RANK.rank}</div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#FF6B35]/20 flex items-center justify-center">Y</div>
              <span className="font-medium">{MY_RANK.user}</span>
            </div>
            <div className="text-green-500">{MY_RANK.profit}</div>
            <div className="text-gray-400">{MY_RANK.winRate} win rate</div>
          </div>
        </div>
      </div>
    </div>
  );
}
