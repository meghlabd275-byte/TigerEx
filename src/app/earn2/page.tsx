'use client';

import React, { useState } from 'react';
import { TrendingUp, Clock, Lock, Zap, ChevronRight, Shield, Percent, Coins } from 'lucide-react';

const EARN_PRODUCTS = [
  { id: 1, name: 'USDT Savings', symbol: 'USDT', apy: '12.5%', duration: 'Flexible', minAmount: '10', locked: false },
  { id: 2, name: 'USDC Savings', symbol: 'USDC', apy: '10.2%', duration: 'Flexible', minAmount: '10', locked: false },
  { id: 3, name: 'ETH Savings', symbol: 'ETH', apy: '5.8%', duration: 'Flexible', minAmount: '0.01', locked: false },
  { id: 4, name: 'BTC Savings', symbol: 'BTC', apy: '4.2%', duration: 'Flexible', minAmount: '0.001', locked: false },
  { id: 5, name: 'USDT Fixed', symbol: 'USDT', apy: '18.0%', duration: '30 days', minAmount: '100', locked: true },
  { id: 6, name: 'USDT Fixed', symbol: 'USDT', apy: '22.5%', duration: '60 days', minAmount: '100', locked: true },
  { id: 7, name: 'USDT Fixed', symbol: 'USDT', apy: '28.0%', duration: '90 days', minAmount: '100', locked: true },
  { id: 8, name: 'BNB Savings', symbol: 'BNB', apy: '8.5%', duration: 'Flexible', minAmount: '0.1', locked: false },
];

export default function EarnPage() {
  const [selectedType, setSelectedType] = useState('all');
  
  const filteredProducts = selectedType === 'all' ? EARN_PRODUCTS : 
    selectedType === 'flexible' ? EARN_PRODUCTS.filter(p => !p.locked) : 
    EARN_PRODUCTS.filter(p => p.locked);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Earn</h1>
        <p className="text-gray-400 mb-6">Earn passive income on your crypto</p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total Earned</p>
            <p className="text-xl font-bold text-green-500">$1,234.56</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Active Investments</p>
            <p className="text-xl font-bold">3</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Avg. APY</p>
            <p className="text-xl font-bold text-[#FF6B35]">~11.2%</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-4">
          {[
            { id: 'all', label: 'All', icon: <Coins className="w-4 h-4" /> },
            { id: 'flexible', label: 'Flexible', icon: <Zap className="w-4 h-4" /> },
            { id: 'locked', label: 'Fixed', icon: <Lock className="w-4 h-4" /> }
          ].map(type => (
            <button key={type.id} onClick={() => setSelectedType(type.id)} 
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${selectedType === type.id ? 'bg-[#FF6B35]' : 'bg-[#14141A]'}`}>
              {type.icon} {type.label}
            </button>
          ))}
        </div>

        {/* Products */}
        <div className="grid gap-3">
          {filteredProducts.map(product => (
            <div key={product.id} className="bg-[#14141A] rounded-xl p-4 hover:bg-[#1E1E24] transition">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${product.locked ? 'bg-purple-500/20' : 'bg-green-500/20'}`}>
                    {product.locked ? <Lock className={`w-5 h-5 ${product.locked ? 'text-purple-500' : 'text-green-500'}`} /> : <Zap className="w-5 h-5 text-green-500" />}
                  </div>
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-gray-500">{product.duration} · Min {product.minAmount} {product.symbol}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-green-500">{product.apy}</p>
                  <p className="text-xs text-gray-500">APY</p>
                </div>
                <button className="ml-4 px-4 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg text-sm">
                  Subscribe
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="mt-6 bg-[#14141A] rounded-xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Secure Savings</p>
            <p className="text-xs text-gray-500 mt-1">Your funds are protected by TigerEx security infrastructure. Fixed-term products have early redemption options.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
