'use client';

import React, { useState } from 'react';
import { Users, Gift, ChevronRight, Copy, Check, TrendingUp, Award } from 'lucide-react';

export default function ReferralPage() {
  const [copied, setCopied] = useState(false);
  const referralCode = 'TGR7K9M2X';

  const copyCode = () => {
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const referralTiers = [
    { tier: 'Bronze', friends: '1-10', reward: '20%', color: '#CD7F32' },
    { tier: 'Silver', friends: '11-50', reward: '25%', color: '#C0C0C0' },
    { tier: 'Gold', friends: '51-200', reward: '30%', color: '#FFD700' },
    { tier: 'Platinum', friends: '201+', reward: '40%', color: '#E5E4E2' },
  ];

  const recentReferrals = [
    { user: 'Alex****23', joined: '2 hours ago', reward: '$45.50' },
    { user: 'John****89', joined: '5 hours ago', reward: '$32.00' },
    { user: 'Mike****45', joined: '1 day ago', reward: '$28.75' },
    { user: 'Sara****12', joined: '2 days ago', reward: '$55.00' },
  ];

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-[#FF6B35]/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Gift className="w-8 h-8 text-[#FF6B35]" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Referral Program</h1>
          <p className="text-gray-400">Invite friends and earn rewards</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs mb-1">Total Referrals</p>
            <p className="text-2xl font-bold">127</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs mb-1">Active</p>
            <p className="text-2xl font-bold">89</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs mb-1">Total Earned</p>
            <p className="text-2xl font-bold text-green-500">$4,567</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs mb-1">Current Tier</p>
            <p className="text-2xl font-bold text-yellow-500">Gold</p>
          </div>
        </div>

        {/* Referral Code */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Your Referral Code</h2>
          <div className="flex items-center gap-4">
            <div className="flex-1 bg-[#0A0A0F] rounded-lg p-4 font-mono text-xl text-center tracking-wider">
              {referralCode}
            </div>
            <button onClick={copyCode} className="px-6 py-3 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg font-medium flex items-center gap-2">
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-4 text-center">Share this code with friends - they get $10, you earn 20%+</p>
        </div>

        {/* Tiers */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-[#FF6B35]" /> Referral Tiers
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {referralTiers.map((tier, i) => (
              <div key={i} className="bg-[#0A0A0F] rounded-lg p-4 text-center">
                <div className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center" style={{ backgroundColor: `${tier.color}30` }}>
                  <Award className="w-4 h-4" style={{ color: tier.color }} />
                </div>
                <p className="font-bold" style={{ color: tier.color }}>{tier.tier}</p>
                <p className="text-xs text-gray-500 mt-1">{tier.friends} friends</p>
                <p className="text-sm font-bold text-green-500 mt-2">{tier.reward}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Referrals */}
        <div className="bg-[#14141A] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Referrals</h2>
          <div className="space-y-3">
            {recentReferrals.map((ref, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-[#0A0A0F] rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                    <Users className="w-4 h-4 text-[#FF6B35]" />
                  </div>
                  <div>
                    <p className="font-medium">{ref.user}</p>
                    <p className="text-xs text-gray-500">{ref.joined}</p>
                  </div>
                </div>
                <p className="text-green-500 font-medium">{ref.reward}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="mt-6 bg-[#14141A] rounded-xl p-4">
          <h3 className="font-medium mb-2">How it works</h3>
          <ol className="text-sm text-gray-400 space-y-2">
            <li>1. Share your referral code with friends</li>
            <li>2. Friends sign up and complete verification</li>
            <li>3. You earn commission on their trading fees</li>
            <li>4. Reach higher tiers for more rewards</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
