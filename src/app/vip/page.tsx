'use client';

import React, { useMemo } from 'react';
import { Crown, Check, Gift, Zap, Shield, Headphones, Percent, RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface VipLevel {
  level: number;
  name?: string;
  trading_requirement?: number;
  volume_requirement?: number;
  tgr_requirement?: number;
  fee_discount?: number;
  maker_fee?: number;
  taker_fee?: number;
  color?: string;
}

interface VipInfo {
  current_level?: number;
  level?: number;
  trading_volume?: number;
  next_level?: number;
  next_level_requirement?: number;
  fee_discount?: number;
}

const BENEFITS = [
  { icon: <Percent className="w-5 h-5" />, title: 'Fee Discounts', description: 'Lower maker and taker fees' },
  { icon: <Zap className="w-5 h-5" />, title: 'Priority Support', description: 'Faster response times' },
  { icon: <Gift className="w-5 h-5" />, title: 'Exclusive Airdrops', description: 'Early access to new tokens' },
  { icon: <Shield className="w-5 h-5" />, title: 'Enhanced Security', description: 'Withdrawal whitelist and more' },
  { icon: <Headphones className="w-5 h-5" />, title: 'Dedicated Support', description: 'Direct line to the team' },
  { icon: <Crown className="w-5 h-5" />, title: 'Exclusive Events', description: 'Invitation-only events' },
];

function formatPercent(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${percent}%`;
}

export default function VIPPage() {
  const levels = useApiResource<unknown>('/api/vip/levels');
  const info = useApiResource<unknown>('/api/vip/info');

  const levelList = useMemo(() => toArray<VipLevel>(levels.data), [levels.data]);
  const vipInfo = (info.data && typeof info.data === 'object'
    ? ((info.data as Record<string, unknown>).data ?? info.data)
    : null) as VipInfo | null;

  const currentLevel = vipInfo?.current_level ?? vipInfo?.level ?? null;
  const current = levelList.find((l) => l.level === currentLevel) ?? null;
  const next = current
    ? levelList.find((l) => l.level === (current.level ?? 0) + 1) ?? null
    : null;

  const tradingVolume = vipInfo?.trading_volume ?? null;
  const nextRequirement =
    next?.trading_requirement ?? next?.volume_requirement ?? vipInfo?.next_level_requirement ?? null;

  const progress =
    tradingVolume !== null && nextRequirement
      ? Math.min(100, (tradingVolume / nextRequirement) * 100)
      : null;

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-yellow-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <Crown className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-2">VIP Program</h1>
          <p className="text-gray-400">Unlock exclusive benefits as you trade more</p>
          <button
            onClick={() => {
              levels.reload();
              info.reload();
            }}
            className="mt-3 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {info.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load your VIP status: {info.error}
          </div>
        )}

        {/* Current Status */}
        <div className="bg-gradient-to-r from-[#CD7F32]/20 to-[#FFD700]/20 rounded-xl p-6 mb-6 border border-[#CD7F32]/30">
          {info.loading ? (
            <p className="text-sm text-gray-400">Loading your VIP status…</p>
          ) : current ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-gray-400">Current Level</p>
                  <p className="text-3xl font-bold" style={{ color: current.color }}>
                    {current.name || `Level ${current.level}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-400">Fee Discount</p>
                  <p className="text-3xl font-bold text-green-500">
                    {formatPercent(current.fee_discount ?? vipInfo?.fee_discount)}
                  </p>
                </div>
              </div>

              {next && nextRequirement !== null && (
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>
                      Trading Volume:{' '}
                      {tradingVolume === null ? '—' : tradingVolume.toLocaleString()}
                    </span>
                    <span>Next: {nextRequirement.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-[#14141A] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-yellow-500 to-yellow-700"
                      style={{ width: `${progress ?? 0}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {tradingVolume === null
                      ? 'Trading volume is not available.'
                      : `${Math.max(0, nextRequirement - tradingVolume).toLocaleString()} more to reach ${
                          next.name || `Level ${next.level}`
                        }`}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">
              {levelList.length === 0
                ? 'The VIP program has no published levels yet.'
                : 'Sign in to see your VIP level.'}
            </p>
          )}
        </div>

        {/* Tier Ladder */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">VIP Tiers</h2>
          {levels.loading && <p className="text-sm text-gray-500">Loading tiers…</p>}
          {levels.error && (
            <p className="text-sm text-red-400">Could not load tiers: {levels.error}</p>
          )}
          {!levels.loading && !levels.error && levelList.length === 0 && (
            <p className="text-sm text-gray-500">No VIP tiers are configured yet.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {levelList.map((tier) => {
              const reached = currentLevel !== null && tier.level <= currentLevel;
              return (
                <div
                  key={tier.level}
                  className={`p-3 rounded-lg text-center ${
                    currentLevel === tier.level ? 'border-2' : 'bg-[#14141A]'
                  }`}
                  style={{ borderColor: tier.color }}
                >
                  <div
                    className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center"
                    style={{ backgroundColor: `${tier.color ?? '#FF6B35'}30` }}
                  >
                    {reached ? (
                      <Check className="w-4 h-4" style={{ color: tier.color }} />
                    ) : (
                      <span style={{ color: tier.color }}>{tier.level}</span>
                    )}
                  </div>
                  <p className="text-xs font-medium" style={{ color: tier.color }}>
                    {tier.name || `Level ${tier.level}`}
                  </p>
                  <p className="text-xs text-gray-500">{formatPercent(tier.fee_discount)}</p>
                </div>
              );
            })}
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
      </div>
    </div>
  );
}
