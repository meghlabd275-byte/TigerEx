'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  TrendingUp, Lock, Award, DollarSign, Percent, Gift, 
  ArrowRight, ChevronRight, Wallet, Coins, LineChart, Calendar
} from 'lucide-react';

// Product interface
interface EarnProduct {
  id: string;
  name: string;
  type: 'staking' | 'savings' | 'launchpool' | 'defi';
  asset: string;
  apy: number;
  duration: number; // days, 0 = flexible
  minAmount: number;
  maxAmount: number | null;
  totalStaked: number;
  rewardPool: number;
  status: 'active' | 'upcoming' | 'ended';
  endsAt?: string;
}

// Demo products
const demoProducts: EarnProduct[] = [
  { id: '1', name: 'Flexible Savings', type: 'savings', asset: 'USDT', apy: 8.5, duration: 0, minAmount: 10, maxAmount: null, totalStaked: 125000000, rewardPool: 0, status: 'active' },
  { id: '2', name: 'Flexible Savings', type: 'savings', asset: 'BTC', apy: 4.2, duration: 0, minAmount: 0.001, maxAmount: null, totalStaked: 45000, rewardPool: 0, status: 'active' },
  { id: '3', name: 'Flexible Savings', type: 'savings', asset: 'ETH', apy: 5.0, duration: 0, minAmount: 0.01, maxAmount: null, totalStaked: 28000, rewardPool: 0, status: 'active' },
  { id: '4', name: 'Simple Earn', type: 'defi', asset: 'BNB', apy: 12.5, duration: 30, minAmount: 0.1, maxAmount: 100, totalStaked: 4500, rewardPool: 1250, status: 'active' },
  { id: '5', name: 'Dual Investment', type: 'defi', asset: 'BTC', apy: 25.0, duration: 7, minAmount: 0.01, maxAmount: 10, totalStaked: 890, rewardPool: 445, status: 'active' },
  { id: '6', name: 'Launchpool', type: 'launchpool', asset: 'NEW', apy: 0, duration: 0, minAmount: 100, maxAmount: 10000, totalStaked: 45000, rewardPool: 500000, status: 'upcoming', endsAt: '2025-06-15' },
];

export default function EarnPage() {
  const [products, setProducts] = useState(demoProducts);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Filter products
  const filteredProducts = selectedType 
    ? products.filter(p => p.type === selectedType)
    : products.slice(showAll ? products.length : 6);

  // Calculate estimated rewards
  const calculateRewards = (product: EarnProduct, amount: number) => {
    return (amount * product.apy / 100);
  };

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0d0d1a]/95 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
                <span className="text-lg font-bold">T</span>
              </div>
            </Link>
            <h1 className="text-xl font-bold">Earn</h1>
          </div>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {/* Hero Banner */}
        <div className="bg-gradient-to-r from-orange-500/20 to-purple-500/20 rounded-xl p-6 border border-white/10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-orange-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold">Start Earning Today</h2>
              <p className="text-gray-400 text-sm">Flexible crypto savings with up to 25% APY</p>
            </div>
            <ChevronRight className="h-6 w-6 text-gray-400" />
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[
            { type: null, label: 'All Products', icon: Coins },
            { type: 'savings', label: 'Savings', icon: Wallet },
            { type: 'staking', label: 'Staking', icon: Lock },
            { type: 'defi', label: 'DeFi', icon: LineChart },
            { type: 'launchpool', label: 'Launchpool', icon: Gift },
          ].map((tab, i) => (
            <button
              key={i}
              onClick={() => setSelectedType(tab.type)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap ${
                selectedType === tab.type
                  ? 'bg-orange-500 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        <div className="grid gap-4">
          {filteredProducts.map((product) => (
            <Link
              key={product.id}
              href={`/earn/${product.id}`}
              className="bg-[#0d0d1a] rounded-xl border border-white/10 p-4 hover:border-orange-500/50 transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{product.name}</span>
                    {product.status === 'upcoming' && (
                      <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">Upcoming</span>
                    )}
                    {product.status === 'ended' && (
                      <span className="px-2 py-0.5 text-xs bg-gray-500/20 text-gray-400 rounded">Ended</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">{product.asset}</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-green-400">
                    {product.apy > 0 ? `${product.apy.toFixed(1)}%` : 'Grab Rewards'}
                  </div>
                  <div className="text-xs text-gray-400">APY</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-400">Duration</div>
                  <div>{product.duration === 0 ? 'Flexible' : `${product.duration} days`}</div>
                </div>
                <div>
                  <div className="text-gray-400">Min. Amount</div>
                  <div>
                    {product.minAmount} {product.asset}
                  </div>
                </div>
              </div>

              {product.totalStaked > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Total staked</span>
                    <span>{product.totalStaked.toLocaleString()} {product.asset}</span>
                  </div>
                </div>
              )}
            </Link>
          ))}
        </div>

        {/* Show More */}
        {!showAll && !selectedType && products.length > 6 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full py-3 bg-white/5 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white"
          >
            Show More ({products.length - 6} more)
          </button>
        )}
      </div>
    </div>
  );
}