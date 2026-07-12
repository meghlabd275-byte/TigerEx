'use client';

import React, { useState } from 'react';
import { Crown, ChevronRight, Check, Gift, Zap, Shield, Headphones, Percent } from 'lucide-react';

const VIP_TIERS = [
  { level: 0, name: 'Regular', tradingReq: 0, feeDiscount: 0, color: '#888' },
  { level: 1, name: 'Bronze', tradingReq: 10000, feeDiscount: 10, color: '#CD7F32' },
  { level: 2, name: 'Silver', tradingReq: 50000, feeDiscount: 20, color: '#C0C0C0' },
  { level: 3, name: 'Gold', tradingReq: 200000, feeDiscount: 30, color: '#FFD700' },
  { level: 4, name: 'Platinum', tradingReq: 1000000, feeDiscount: 40, color: '#E5E4E2' },
  { level: 5, name: 'Diamond', tradingReq: 5000000, feeDiscount: 50, color: '#B9F2FF' },
  { level: 6, name: 'VIP', tradingReq: 20000000, feeDiscount: 60, color: '#9B59B6' },
];

const BENEFITS = [
  { icon: <Percent className="w-5 h-5" />, title: 'Fee Discounts', description: 'Up to 60% off trading fees' },
  { icon: <Zap className="w-5 h-5" />, title: 'Priority Support', description: 'Dedicated account manager' },
  { icon: <Gift className="w-5 h-5" />, title: 'Exclusive Airdrops', description: 'Early access to new tokens' },
  { icon: <Shield className="w-5 h-5" />, title: 'Enhanced Security', description: 'Withdrawal whitelist & more' },
  { icon: <Headphones className="w-5 h-5" />, title: '24/7 VIP Support', description: 'Direct line to team' },
  { icon: <Crown className="w-5 h-5" />, title: 'Exclusive Events', description: 'VIP-only conferences' },
];

export default function VIPPage() {
  const [currentTier, setCurrentTier] = useState(2);
  const current = VIP_TIERS[currentTier];
  const tradingVolume = 75000;

  const nextTier = VIP_TIERS[currentTier + 1];
  const progress = nextTier ? (tradingVolume / nextTier.tradingReq) * 100 : 100;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-yellow-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <Crown className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-2">VIP Program</h1>
          <p className="text-gray-400">Unlock exclusive benefits as you trade more</p>
        </div>

        {/* Current Status */}
        <div className="bg-gradient-to-r from-[#CD7F32]/20 to-[#FFD700]/20 rounded-xl p-6 mb-6 border border-[#CD7F32]/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-400">Current Level</p>
              <p className="text-3xl font-bold" style={{ color: current.color }}>{current.name}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-400">Fee Discount</p>
              <p className="text-3xl font-bold text-green-500">{current.feeDiscount}%</p>
            </div>
          </div>
          
          {nextTier && (
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>Trading Volume: ${tradingVolume.toLocaleString()}</span>
                <span>Next: ${nextTier.tradingReq.toLocaleString()}</span>
              </div>
              <div className="h-2 bg-[#14141A] rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-yellow-500 to-yellow-700" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-2">${(nextTier.tradingReq - tradingVolume).toLocaleString()} more to reach {nextTier.name}</p>
            </div>
          )}
        </div>

        {/* Tier Ladder */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">VIP Tiers</h2>
          <div className="grid grid-cols-7 gap-2">
            {VIP_TIERS.map((tier, i) => (
              <div key={i} className={`p-3 rounded-lg text-center ${i === currentTier ? 'border-2' : 'bg-[#14141A]'}`}
                style={{ borderColor: tier.color }}>
                <div className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center" style={{ backgroundColor: `${tier.color}30` }}>
                  {i <= currentTier ? <Check className="w-4 h-4" style={{ color: tier.color }} /> : <span style={{ color: tier.color }}>{i}</span>}
                </div>
                <p className="text-xs font-medium" style={{ color: tier.color }}>{tier.name}</p>
                <p className="text-xs text-gray-500">{tier.feeDiscount}%</p>
              </div>
            ))}
          </div>
        </div>

        {/* Benefits */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">VIP Benefits</h2>
          <div className="grid grid-cols-2 gap-3">
            {BENEFITS.map((benefit, i) => (
              <div key={i} className="bg-[#14141A] rounded-xl p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-[#FF6B35]/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-[#FF6B35]">{benefit.icon}</span>
                </div>
                <div>
                  <p className="font-medium">{benefit.title}</p>
                  <p className="text-xs text-gray-500">{benefit.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Apply */}
        <div className="bg-[#14141A] rounded-xl p-6 text-center">
          <p className="text-gray-400 mb-4">Want to become a VIP?</p>
          <button className="px-6 py-2 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg font-medium">
            Contact VIP Team
          </button>
        </div>
      </div>
    </div>
  );
}
