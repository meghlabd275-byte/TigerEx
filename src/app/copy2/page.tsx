'use client';

import React, { useState } from 'react';
import { TrendingUp, Star, Users, ChevronRight, Copy, Shield, Clock, Award, Activity } from 'lucide-react';

const TOP_TRADERS = [
  { id: 1, name: 'CryptoMaster', avatar: 'CM', winRate: '94%', profit: '1,234%', followers: 12500, daysActive: 365, specialties: ['BTC', 'ETH', 'SOL'] },
  { id: 2, name: 'DeFiWhale', avatar: 'DW', winRate: '89%', profit: '892%', followers: 8900, daysActive: 280, specialties: ['SOL', 'AVAX', 'MATIC'] },
  { id: 3, name: 'AltcoinKing', avatar: 'AK', winRate: '86%', profit: '756%', followers: 6700, daysActive: 180, specialties: ['XRP', 'ADA', 'DOGE'] },
  { id: 4, name: 'SwingTrader', avatar: 'ST', winRate: '91%', profit: '534%', followers: 4500, daysActive: 150, specialties: ['BTC', 'ETH'] },
  { id: 5, name: 'MomentumHunter', avatar: 'MH', winRate: '84%', profit: '423%', followers: 3200, daysActive: 120, specialties: ['SOL', 'BNB', 'MATIC'] },
];

const COPY_POSITIONS = [
  { id: 1, trader: 'CryptoMaster', pair: 'BTC/USDT', side: 'long', amount: '1,234', pnl: '+5.2%', copied: '2 days ago' },
  { id: 2, trader: 'DeFiWhale', pair: 'SOL/USDT', side: 'long', amount: '567', pnl: '+12.4%', copied: '5 hours ago' },
];

export default function CopyTrading() {
  const [selectedTab, setSelectedTab] = useState('traders');
  const [selectedTrader, setSelectedTrader] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Copy Trading</h1>
        <p className="text-gray-400 mb-6">Follow top traders and copy their strategies</p>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total Copiers</p>
            <p className="text-xl font-bold">45,678</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Traders</p>
            <p className="text-xl font-bold">1,234</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">24h Volume</p>
            <p className="text-xl font-bold text-green-500">$12.5M</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Avg. ROI</p>
            <p className="text-xl font-bold text-[#FF6B35]">+45%</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {[
            { id: 'traders', label: 'Top Traders', icon: <TrendingUp className="w-4 h-4" /> },
            { id: 'copiers', label: 'My Copiers', icon: <Users className="w-4 h-4" /> },
            { id: 'positions', label: 'Copy Positions', icon: <Activity className="w-4 h-4" /> },
          ].map(tab => (
            <button key={tab.id} onClick={() => setSelectedTab(tab.id)} 
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${selectedTab === tab.id ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {selectedTab === 'traders' && (
          <div className="grid gap-3">
            {TOP_TRADERS.map(trader => (
              <div key={trader.id} className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-[#FF6B35] to-[#ff8f65] rounded-full flex items-center justify-center font-bold">
                      {trader.avatar}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{trader.name}</p>
                        <Award className="w-4 h-4 text-yellow-500" />
                      </div>
                      <div className="flex gap-2 mt-1">
                        {trader.specialties.map(s => (
                          <span key={s} className="text-xs bg-[#FF6B35]/20 text-[#FF6B35] px-2 py-0.5 rounded">{s}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-8">
                    <div className="text-center">
                      <p className="text-green-500 font-bold">{trader.winRate}</p>
                      <p className="text-xs text-gray-500">Win Rate</p>
                    </div>
                    <div className="text-center">
                      <p className="text-green-500 font-bold">{trader.profit}</p>
                      <p className="text-xs text-gray-500">Total Profit</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold">{trader.followers.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">Followers</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-400">{trader.daysActive}</p>
                      <p className="text-xs text-gray-500">Days</p>
                    </div>
                    <button className="px-4 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg text-sm flex items-center gap-2">
                      <Copy className="w-4 h-4" /> Copy
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedTab === 'positions' && COPY_POSITIONS.length > 0 && (
          <div className="grid gap-3">
            {COPY_POSITIONS.map(pos => (
              <div key={pos.id} className="bg-[#14141A] rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center">
                      <Copy className="w-5 h-5 text-green-500" />
                    </div>
                    <div>
                      <p className="font-medium">{pos.trader}</p>
                      <p className="text-xs text-gray-500">{pos.pair} · {pos.side}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-8">
                    <div>
                      <p className="text-sm text-gray-400">Amount</p>
                      <p className="font-medium">${pos.amount}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">PnL</p>
                      <p className="font-bold text-green-500">{pos.pnl}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Copied</p>
                      <p className="text-sm">{pos.copied}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedTab === 'positions' && COPY_POSITIONS.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Copy className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No active copy positions</p>
            <p className="text-sm">Start copying a trader to see positions here</p>
          </div>
        )}

        {/* Protection */}
        <div className="mt-6 bg-[#14141A] rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Copy Trading Protection</p>
            <p className="text-xs text-gray-500 mt-1">All traders are verified. You can stop copying anytime. Maximum drawdown limits protect your funds.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
