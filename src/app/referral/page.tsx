'use client';

import React, { useMemo, useState } from 'react';
import { Users, Gift, Copy, Check, Award, RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface ReferralStats {
  code?: string;
  totalReferrals?: number;
  activeReferrals?: number;
  pendingReferrals?: number;
  totalEarned?: number;
  currency?: string;
  currentTier?: string;
  commissionRate?: number;
  nextTier?: string | null;
  nextTierVolumeRequirement?: number | null;
  attributedVolume?: number;
}

interface ReferralRecord {
  referralId?: string;
  refereeId?: string;
  username?: string | null;
  status?: string;
  tier?: string;
  commissionEarned?: number;
  currency?: string;
  createdAt?: string;
}

interface ProgramTier {
  name?: string;
  requiredVolume?: number;
  commissionRate?: number;
  minReferrals?: number;
}

const TIER_COLORS: Record<string, string> = {
  Bronze: '#CD7F32',
  Silver: '#C0C0C0',
  Gold: '#FFD700',
  Platinum: '#E5E4E2',
};

function unwrap<T>(payload: unknown): T | null {
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
    return (payload as Record<string, unknown>).data as T;
  }
  return (payload as T) ?? null;
}

function toArray<T>(payload: unknown): T[] {
  const inner = unwrap<unknown>(payload);
  if (Array.isArray(inner)) return inner as T[];
  if (Array.isArray(payload)) return payload as T[];
  return [];
}

function formatAmount(value: number | undefined, currency = 'USDT'): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}

function formatPercent(rate: number | undefined): string {
  if (rate === undefined || rate === null || Number.isNaN(rate)) return '—';
  return `${Math.round(rate * 100)}%`;
}

function maskUser(username: string | null | undefined, id: string | undefined): string {
  if (username && username.length > 2) {
    return `${username.slice(0, 3)}***${username.slice(-2)}`;
  }
  if (id) return `${id.slice(0, 6)}…`;
  return 'Anonymous';
}

export default function ReferralPage() {
  const [copied, setCopied] = useState(false);

  const info = useApiResource<unknown>('/api/referral/info');
  const referrals = useApiResource<unknown>('/api/referral/users?limit=10');
  const program = useApiResource<unknown>('/api/referral/program');

  const stats = unwrap<ReferralStats>(info.data);
  const referralCode = stats?.code ?? '';
  const currency = stats?.currency ?? 'USDT';

  const tiers = useMemo(() => toArray<ProgramTier>(program.data), [program.data]);
  const recentReferrals = useMemo(() => toArray<ReferralRecord>(referrals.data), [referrals.data]);

  const copyCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the code stays visible for manual copy.
    }
  };

  const loading = info.loading;
  const error = info.error;

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

        {error && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
            <span>{error}</span>
            <button
              onClick={info.reload}
              className="flex items-center gap-1 rounded-lg border border-red-400/40 px-3 py-1.5 hover:bg-red-500/20"
            >
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#14141A] rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs mb-1">Total Referrals</p>
            <p className="text-2xl font-bold">{loading ? '—' : stats?.totalReferrals ?? 0}</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs mb-1">Active</p>
            <p className="text-2xl font-bold">{loading ? '—' : stats?.activeReferrals ?? 0}</p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs mb-1">Total Earned</p>
            <p className="text-2xl font-bold text-green-500">
              {loading ? '—' : formatAmount(stats?.totalEarned ?? 0, currency)}
            </p>
          </div>
          <div className="bg-[#14141A] rounded-xl p-4 text-center">
            <p className="text-gray-400 text-xs mb-1">Current Tier</p>
            <p className="text-2xl font-bold text-yellow-500">{loading ? '—' : stats?.currentTier ?? '—'}</p>
          </div>
        </div>

        {/* Referral Code */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Your Referral Code</h2>
          <div className="flex items-center gap-4">
            <div className="flex-1 bg-[#0A0A0F] rounded-lg p-4 font-mono text-xl text-center tracking-wider">
              {loading ? '—' : referralCode || 'Unavailable'}
            </div>
            <button
              onClick={copyCode}
              disabled={!referralCode}
              className="px-6 py-3 bg-[#FF6B35] hover:bg-[#ff8f65] rounded-lg font-medium flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-4 text-center">
            Share this code with friends - you earn{' '}
            {loading ? 'a commission' : formatPercent(stats?.commissionRate)} of their trading fees
          </p>
        </div>

        {/* Tiers */}
        <div className="bg-[#14141A] rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-[#FF6B35]" /> Referral Tiers
          </h2>
          {program.loading ? (
            <p className="text-sm text-gray-500">Loading tiers…</p>
          ) : program.error ? (
            <p className="text-sm text-red-400">{program.error}</p>
          ) : tiers.length === 0 ? (
            <p className="text-sm text-gray-500">No referral tiers are configured.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {tiers.map((tier, i) => {
                const color = TIER_COLORS[tier.name ?? ''] ?? '#FF6B35';
                const isCurrent = tier.name === stats?.currentTier;
                return (
                  <div
                    key={i}
                    className={`bg-[#0A0A0F] rounded-lg p-4 text-center ${
                      isCurrent ? 'ring-2 ring-[#FF6B35]' : ''
                    }`}
                  >
                    <div
                      className="w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center"
                      style={{ backgroundColor: `${color}30` }}
                    >
                      <Award className="w-4 h-4" style={{ color }} />
                    </div>
                    <p className="font-bold" style={{ color }}>{tier.name ?? '—'}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {(tier.requiredVolume ?? 0).toLocaleString()} volume
                    </p>
                    <p className="text-sm font-bold text-green-500 mt-2">
                      {formatPercent(tier.commissionRate)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent Referrals */}
        <div className="bg-[#14141A] rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Referrals</h2>
          {referrals.loading ? (
            <p className="text-sm text-gray-500">Loading referrals…</p>
          ) : referrals.error ? (
            <p className="text-sm text-red-400">{referrals.error}</p>
          ) : recentReferrals.length === 0 ? (
            <p className="text-sm text-gray-500">
              No referrals yet. Share your code to start earning.
            </p>
          ) : (
            <div className="space-y-3">
              {recentReferrals.map((ref, i) => (
                <div key={ref.referralId ?? i} className="flex items-center justify-between p-3 bg-[#0A0A0F] rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-[#FF6B35]/20 rounded-full flex items-center justify-center">
                      <Users className="w-4 h-4 text-[#FF6B35]" />
                    </div>
                    <div>
                      <p className="font-medium">{maskUser(ref.username, ref.refereeId)}</p>
                      <p className="text-xs text-gray-500">
                        {ref.createdAt ? new Date(ref.createdAt).toLocaleString() : '—'} · {ref.status ?? 'pending'}
                      </p>
                    </div>
                  </div>
                  <p className="text-green-500 font-medium">
                    {formatAmount(ref.commissionEarned ?? 0, ref.currency ?? currency)}
                  </p>
                </div>
              ))}
            </div>
          )}
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
