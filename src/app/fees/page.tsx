'use client';

import React, { useMemo, useState } from 'react';
import { Percent, RefreshCw } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';

// Matches the FeeConfig model served by the backend at GET /fees.
interface FeeConfig {
  id: string;
  type: string;
  asset: string;
  network?: string;
  fee_type: 'fixed' | 'percentage' | string;
  fee_amount: number;
  min_fee?: number;
  max_fee?: number;
  updated_at?: string;
}

interface VipLevel {
  level: number;
  name?: string;
  maker_fee?: number;
  taker_fee?: number;
  volume_requirement?: number;
  tgr_requirement?: number;
  fee_discount?: number;
}

function formatFee(fee: FeeConfig): string {
  if (fee.fee_type === 'percentage') {
    const percent = Math.abs(fee.fee_amount) <= 1 ? fee.fee_amount * 100 : fee.fee_amount;
    return `${percent}%`;
  }
  return String(fee.fee_amount);
}

function asPercent(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${percent}%`;
}

export default function FeesPage() {
  const [activeTab, setActiveTab] = useState('trading');

  const fees = useApiResource<unknown>('/api/fees');
  const vip = useApiResource<unknown>('/api/vip/levels');

  const configs = useMemo(() => toArray<FeeConfig>(fees.data), [fees.data]);
  const vipLevels = useMemo(() => toArray<VipLevel>(vip.data), [vip.data]);

  const tradeFees = configs.filter((c) => c.type === 'trade');
  const withdrawalFees = configs.filter((c) => c.type === 'withdraw');
  const depositFees = configs.filter((c) => c.type === 'deposit');

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Fees</h1>
            <p className="text-gray-400">Transparent fee structure</p>
          </div>
          <button
            onClick={fees.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {fees.error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Could not load fees: {fees.error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {['trading', 'withdrawal', 'deposit'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm capitalize ${
                activeTab === tab ? 'bg-[#FF6B35]' : 'bg-[#14141A]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'trading' && (
          <>
            <div className="bg-[#14141A] rounded-xl p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Percent className="w-5 h-5 text-[#FF6B35]" /> Trading Fees
              </h2>
              <p className="text-sm text-gray-400 mb-4">
                Fees are published by the exchange fee engine
              </p>

              {fees.loading && <p className="text-sm text-gray-500">Loading fees…</p>}
              {!fees.loading && !fees.error && tradeFees.length === 0 && (
                <p className="text-sm text-gray-500">No trading fees are configured yet.</p>
              )}

              {tradeFees.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[rgba(255,255,255,0.1)]">
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Asset</th>
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Type</th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium">Fee</th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium">Min / Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeFees.map((row) => (
                        <tr key={row.id} className="border-b border-[rgba(255,255,255,0.05)]">
                          <td className="py-3 px-4">{row.asset}</td>
                          <td className="py-3 px-4 capitalize text-gray-400">{row.fee_type}</td>
                          <td className="py-3 px-4 text-right text-green-500">{formatFee(row)}</td>
                          <td className="py-3 px-4 text-right text-gray-400">
                            {row.min_fee ?? '—'} / {row.max_fee ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-[#14141A] rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">VIP Fee Levels</h2>
              {vip.loading && <p className="text-sm text-gray-500">Loading VIP levels…</p>}
              {vip.error && (
                <p className="text-sm text-red-400">Could not load VIP levels: {vip.error}</p>
              )}
              {!vip.loading && !vip.error && vipLevels.length === 0 && (
                <p className="text-sm text-gray-500">No VIP levels are configured yet.</p>
              )}
              {vipLevels.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[rgba(255,255,255,0.1)]">
                        <th className="text-left py-3 px-4 text-gray-400 font-medium">Level</th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium">
                          Maker
                        </th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium">
                          Taker
                        </th>
                        <th className="text-right py-3 px-4 text-gray-400 font-medium">
                          Volume Requirement
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {vipLevels.map((level) => (
                        <tr
                          key={level.level}
                          className="border-b border-[rgba(255,255,255,0.05)]"
                        >
                          <td className="py-3 px-4">
                            {level.name ? `${level.level} — ${level.name}` : level.level}
                          </td>
                          <td className="py-3 px-4 text-right text-green-500">
                            {asPercent(level.maker_fee)}
                          </td>
                          <td className="py-3 px-4 text-right text-green-500">
                            {asPercent(level.taker_fee)}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-400">
                            {level.volume_requirement === undefined
                              ? '—'
                              : level.volume_requirement.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {(activeTab === 'withdrawal' || activeTab === 'deposit') && (
          <div className="bg-[#14141A] rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4 capitalize">{activeTab} Fees</h2>
            <p className="text-sm text-gray-400 mb-4">
              Network fees may change due to network conditions
            </p>
            {(activeTab === 'withdrawal' ? withdrawalFees : depositFees).length === 0 ? (
              <p className="text-sm text-gray-500">
                {fees.loading
                  ? `Loading ${activeTab} fees…`
                  : `No ${activeTab} fees are configured yet.`}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[rgba(255,255,255,0.1)]">
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Asset</th>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Network</th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium">Fee</th>
                      <th className="text-right py-3 px-4 text-gray-400 font-medium">Min / Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeTab === 'withdrawal' ? withdrawalFees : depositFees).map((row) => (
                      <tr key={row.id} className="border-b border-[rgba(255,255,255,0.05)]">
                        <td className="py-3 px-4">{row.asset}</td>
                        <td className="py-3 px-4 text-gray-400">{row.network ?? '—'}</td>
                        <td className="py-3 px-4 text-right">{formatFee(row)}</td>
                        <td className="py-3 px-4 text-right text-gray-400">
                          {row.min_fee ?? '—'} / {row.max_fee ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
