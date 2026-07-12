'use client';

import React, { useState } from 'react';
import { Lock, Zap, ChevronRight, Clock, Shield, TrendingUp, Coins, ArrowUpDown } from 'lucide-react';

const STAKING_PRODUCTS = [
  { id: 1, name: 'Ethereum 2.0', symbol: 'ETH', apy: '4.2%', lockPeriod: 'Until Merge', minStake: '0.01', rewards: 'Weekly', type: 'locked' },
  { id: 2, name: 'Solana', symbol: 'SOL', apy: '6.8%', lockPeriod: 'None', minStake: '1', rewards: 'Daily', type: 'flexible' },
  { id: 3, name: 'Cardano', symbol: 'ADA', apy: '5.1%', lockPeriod: 'None', minStake: '10', rewards: 'Epoch', type: 'flexible' },
  { id: 4, name: 'Polkadot', symbol: 'DOT', apy: '12.5%', lockPeriod: '28 days', minStake: '1', rewards: 'Daily', type: 'locked' },
  { id: 5, name: 'Cosmos', symbol: 'ATOM', apy: '18.2%', lockPeriod: '21 days', minStake: '0.1', rewards: 'Daily', type: 'locked' },
  { id: 6, name: 'Near', symbol: 'NEAR', apy: '9.5%', lockPeriod: 'None', minStake: '1', rewards: 'Daily', type: 'flexible' },
  { id: 7, name: 'Aptos', symbol: 'APT', apy: '8.1%', lockPeriod: 'None', minStake: '1', rewards: 'Daily', type: 'flexible' },
  { id: 8, name: 'Chainlink', symbol: 'LINK', apy: '5.5%', lockPeriod: 'None', minStake: '10', rewards: 'Daily', type: 'flexible' },
];

const YOUR_STAKES = [
  { id: 1, name: 'Solana', symbol: 'SOL', staked: '150', rewards: '2.45', apy: '6.8%' },
  { id: 2, name: 'Ethereum 2.0', symbol: 'ETH', staked: '5.2', rewards: '0.12', apy: '4.2%' },
];

export default function StakingPage() {
  const [selectedType, setSelectedType] = useState('all');

  const filteredProducts = selectedType === 'all' ? STAKING_PRODUCTS : STAKING_PRODUCTS.filter(p => p.type === selectedType);
  const totalStaked = YOUR_STAKES.reduce((sum, s) => sum + parseFloat(s.staked), 0);
  const totalRewards = YOUR_STAKES.reduce((sum, s) => sum + parseFloat(s.rewards), 0);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total Staked</p>
            <p className="text-xl font-bold">{totalStaked.toFixed(2)}</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Pending Rewards</p>
            <p className="text-xl font-bold text-green-500">{totalRewards.toFixed(4)}</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Est. Annual Yield</p>
            <p className="text-xl font-bold text-[#FF6B35]">~5.8%</p>
          </div>
        </div>

        {/* Your Stakes */}
        {YOUR_STAKES.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Your Stakes</h2>
            <div className="grid gap-3">
              {YOUR_STAKES.map(stake => (
                <div key={stake.id} className="bg-[#14141A] rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                      <Coins className="w-5 h-5 text-[#FF6B35]" />
                    </div>
                    <div>
                      <p className="font-medium">{stake.name}</p>
                      <p className="text-xs text-gray-500">{stake.apy} APY</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{stake.staked} {stake.symbol}</p>
                    <p className="text-xs text-green-500">+{stake.rewards} rewards</p>
                  </div>
                  <button className="text-[#FF6B35] text-sm">Manage</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-2 mb-4">
          {['all', 'flexible', 'locked'].map(type => (
            <button key={type} onClick={() => setSelectedType(type)} className={`px-4 py-2 rounded-lg text-sm capitalize ${selectedType === type ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {type}
            </button>
          ))}
        </div>

        {/* Products */}
        <h2 className="text-lg font-semibold mb-3">Staking Products</h2>
        <div className="grid gap-3">
          {filteredProducts.map(product => (
            <div key={product.id} className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <span className="text-blue-500 font-bold">{product.symbol.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-gray-500">{product.type === 'flexible' ? 'Flexible' : `Lock ${product.lockPeriod}`}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-green-500">{product.apy}</p>
                  <p className="text-xs text-gray-500">APY</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-400">
                <span>Min: {product.minStake} {product.symbol}</span>
                <span>Rewards: {product.rewards}</span>
                <button className="text-[#FF6B35] flex items-center gap-1">
                  Stake <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="mt-6 bg-[#14141A] rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Staking Protection</p>
            <p className="text-xs text-gray-500 mt-1">Your staked assets are secured by TigerEx infrastructure. Rewards are distributed automatically.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
