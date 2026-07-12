'use client';

import React, { useState } from 'react';
import { Droplets, TrendingUp, Clock, Award, Info } from 'lucide-react';

const POOLS = [
  { id: 1, pair: 'TGR/USDT', tvl: '$12.5M', apy: '45.2%', reward: 'TGR', dailyReward: '25,000', volume: '$5.2M' },
  { id: 2, pair: 'ETH/USDT', tvl: '$45.2M', apy: '12.8%', reward: 'TGR', dailyReward: '15,000', volume: '$12.8M' },
  { id: 3, pair: 'BTC/USDT', tvl: '$78.9M', apy: '8.5%', reward: 'TGR', dailyReward: '10,000', volume: '$25.6M' },
  { id: 4, pair: 'BNB/USDT', tvl: '$23.4M', apy: '18.3%', reward: 'TGR', dailyReward: '8,000', volume: '$8.9M' },
  { id: 5, pair: 'SOL/USDT', tvl: '$15.6M', apy: '22.1%', reward: 'TGR', dailyReward: '6,000', volume: '$6.2M' },
];

const MY_STAKES = [
  { id: 1, pair: 'TGR/USDT', staked: '5,000', value: '$12,250', share: '0.098%', earnings: '+450 TGR' },
];

export default function LiquidityMining() {
  const [selectedPool, setSelectedPool] = useState<number | null>(null);
  const [amount, setAmount] = useState('');

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Liquidity Mining</h1>
            <p className="text-gray-400">Earn rewards by providing liquidity</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total TVL</p>
            <p className="text-xl font-bold">$175.6M</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">My Staked</p>
            <p className="text-xl font-bold">$12,250</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">24h Rewards</p>
            <p className="text-xl font-bold text-green-500">+450 TGR</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Avg APY</p>
            <p className="text-xl font-bold text-[#FF6B35]">21.4%</p>
          </div>
        </div>

        {/* Pools */}
        <div className="space-y-3 mb-6">
          {POOLS.map(pool => (
            <div key={pool.id} onClick={() => setSelectedPool(selectedPool === pool.id ? null : pool.id)}
              className={`bg-[#14141A] rounded-xl p-4 cursor-pointer transition ${selectedPool === pool.id ? 'ring-2 ring-[#FF6B35]' : 'hover:bg-[#1E1E24]'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#FF6B35] to-[#ff8f65] rounded-full flex items-center justify-center font-bold">
                    {pool.pair.split('/')[0].slice(0,2)}
                  </div>
                  <div>
                    <p className="font-bold">{pool.pair}</p>
                    <p className="text-xs text-gray-500">TVL: {pool.tvl}</p>
                  </div>
                </div>
                <div className="flex items-center gap-8">
                  <div className="text-center">
                    <p className="text-green-500 font-bold text-lg">{pool.apy}</p>
                    <p className="text-xs text-gray-500">APY</p>
                  </div>
                  <div className="text-center">
                    <p className="font-bold">{pool.dailyReward}</p>
                    <p className="text-xs text-gray-500">{pool.reward}/day</p>
                  </div>
                  <Droplets className="w-5 h-5 text-gray-500" />
                </div>
              </div>

              {/* Expanded Details */}
              {selectedPool === pool.id && (
                <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.1)]">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-[#0A0A0F] rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">24h Volume</p>
                      <p className="font-medium">{pool.volume}</p>
                    </div>
                    <div className="bg-[#0A0A0F] rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Your Share</p>
                      <p className="font-medium">0%</p>
                    </div>
                    <div className="bg-[#0A0A0F] rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Est. Daily</p>
                      <p className="font-medium text-green-500">0 {pool.reward}</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount"
                      className="flex-1 bg-[#0A0A0F] rounded-lg py-2 px-3" />
                    <button className="px-6 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg font-medium">
                      Add Liquidity
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* My Stakes */}
        {MY_STAKES.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4">My Stakes</h2>
            <div className="space-y-3">
              {MY_STAKES.map(stake => (
                <div key={stake.id} className="bg-[#14141A] rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                        <Droplets className="w-5 h-5 text-[#FF6B35]" />
                      </div>
                      <div>
                        <p className="font-medium">{stake.pair}</p>
                        <p className="text-xs text-gray-500">{stake.staked} LP Tokens</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div><p className="text-xs text-gray-500">Value</p><p className="font-medium">{stake.value}</p></div>
                      <div><p className="text-xs text-gray-500">Share</p><p className="font-medium">{stake.share}</p></div>
                      <div><p className="text-xs text-gray-500">Earnings</p><p className="text-green-500 font-medium">{stake.earnings}</p></div>
                      <button className="px-4 py-2 border border-red-500 text-red-500 rounded-lg text-sm hover:bg-red-500/10">
                        Withdraw
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-blue-500">About Liquidity Mining</p>
            <p className="text-xs text-gray-400 mt-1">Provide liquidity to trading pairs and earn TGR rewards. Impermanent loss may occur. Rewards are distributed daily.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
