'use client';

import React, { useMemo, useState } from 'react';
import { Lock, Zap, Clock, Coins, RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

interface StakingPool {
  id: string;
  name?: string;
  symbol?: string;
  asset?: string;
  apy?: number;
  lock_period_days?: number;
  lock_period?: string;
  min_stake?: number;
  rewards?: string;
  type?: string;
  status?: string;
}

interface UserStake {
  id: string;
  pool_id?: string;
  symbol?: string;
  asset?: string;
  amount?: number;
  rewards?: number;
  apy?: number;
  status?: string;
}

function poolSymbol(pool: StakingPool): string {
  return pool.symbol || pool.asset || '—';
}

function poolApy(pool: StakingPool): string {
  if (pool.apy === undefined || pool.apy === null || Number.isNaN(pool.apy)) return '—';
  // The API reports APY either as a percentage (4.2) or a fraction (0.042).
  const percent = pool.apy <= 1 ? pool.apy * 100 : pool.apy;
  return `${percent.toFixed(2)}%`;
}

function lockLabel(pool: StakingPool): string {
  if (pool.lock_period) return pool.lock_period;
  const days = pool.lock_period_days ?? 0;
  return days > 0 ? `${days} days` : 'Flexible';
}

export default function StakingPage() {
  const [selectedType, setSelectedType] = useState('all');

  const pools = useApiResource<unknown>('/api/staking/pools');
  const stakes = useApiResource<unknown>('/api/staking/list');

  const poolList = useMemo(() => toArray<StakingPool>(pools.data), [pools.data]);
  const stakeList = useMemo(() => toArray<UserStake>(stakes.data), [stakes.data]);

  const filteredPools = useMemo(() => {
    if (selectedType === 'all') return poolList;
    return poolList.filter((p) => {
      const kind = (p.type || (lockLabel(p) === 'Flexible' ? 'flexible' : 'locked')).toLowerCase();
      return kind === selectedType;
    });
  }, [poolList, selectedType]);

  const totalStaked = stakeList.reduce((sum, s) => sum + (s.amount ?? 0), 0);
  const totalRewards = stakeList.reduce((sum, s) => sum + (s.rewards ?? 0), 0);
  const weightedApy = useMemo(() => {
    const total = stakeList.reduce((sum, s) => sum + (s.amount ?? 0), 0);
    if (total === 0) return null;
    const weighted = stakeList.reduce((sum, s) => sum + (s.amount ?? 0) * (s.apy ?? 0), 0);
    return (weighted / total) * 100;
  }, [stakeList]);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Total Staked</p>
            <p className="text-xl font-bold">
              {stakes.loading ? '…' : totalStaked.toLocaleString(undefined, { maximumFractionDigits: 8 })}
            </p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Pending Rewards</p>
            <p className="text-xl font-bold text-green-500">
              {stakes.loading ? '…' : totalRewards.toLocaleString(undefined, { maximumFractionDigits: 8 })}
            </p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Weighted APY</p>
            <p className="text-xl font-bold text-[#FF6B35]">
              {weightedApy === null ? '—' : `${weightedApy.toFixed(2)}%`}
            </p>
          </div>
        </div>

        {stakes.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load your stakes: {stakes.error}
          </div>
        )}

        {/* Your Stakes */}
        {stakeList.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Your Stakes</h2>
            <div className="grid gap-3">
              {stakeList.map((stake) => (
                <div
                  key={stake.id}
                  className="bg-[#14141A] rounded-xl p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                      <Coins className="w-5 h-5 text-[#FF6B35]" />
                    </div>
                    <div>
                      <p className="font-medium">{stake.symbol || stake.asset || '—'}</p>
                      <p className="text-xs text-gray-500">
                        {stake.apy === undefined ? '—' : `${(stake.apy * 100).toFixed(2)}% APY`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">
                      {(stake.amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                    </p>
                    <p className="text-xs text-green-500">
                      +{(stake.rewards ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}{' '}
                      rewards
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available Products */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Staking Products</h2>
          <button
            onClick={pools.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          {['all', 'flexible', 'locked'].map((t) => (
            <button
              key={t}
              onClick={() => setSelectedType(t)}
              className={`px-4 py-2 rounded-lg text-sm capitalize ${
                selectedType === t ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {pools.loading && <p className="text-sm text-gray-500">Loading products…</p>}
        {pools.error && (
          <p className="text-sm text-red-400">Could not load products: {pools.error}</p>
        )}
        {!pools.loading && !pools.error && filteredPools.length === 0 && (
          <div className="bg-[#14141A] rounded-xl p-8 text-center text-gray-500">
            No staking products are available for this filter.
          </div>
        )}

        <div className="grid gap-3">
          {filteredPools.map((pool) => (
            <div
              key={pool.id}
              className="bg-[#14141A] rounded-xl p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                  {lockLabel(pool) === 'Flexible' ? (
                    <Zap className="w-5 h-5 text-[#FF6B35]" />
                  ) : (
                    <Lock className="w-5 h-5 text-[#FF6B35]" />
                  )}
                </div>
                <div>
                  <p className="font-medium">{pool.name || poolSymbol(pool)}</p>
                  <p className="text-xs text-gray-500 flex items-center gap-2">
                    <Clock className="w-3 h-3" /> {lockLabel(pool)}
                    {pool.min_stake !== undefined && (
                      <span>· min {pool.min_stake} {poolSymbol(pool)}</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-[#FF6B35]">{poolApy(pool)}</p>
                <p className="text-xs text-gray-500">{pool.rewards ?? 'APY'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
