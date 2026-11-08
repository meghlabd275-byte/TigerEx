'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Rocket } from 'lucide-react';
import { useApiResource, toArray } from '@/lib/useApiResource';
import { readAuthToken } from '@/lib/auth/token';

interface LaunchpoolCampaign {
  id: string;
  project_id: string;
  name: string;
  description: string;
  reward_token: string;
  stake_token: string;
  total_rewards: number;
  min_stake: number;
  apy: number;
  status: string;
  start_time: string;
  end_time: string;
  participants: number;
  total_staked: number;
}

interface LaunchpoolStake {
  id: string;
  project_id: string;
  stake_amount: number;
  reward_amount: number;
  claimed: boolean;
  created_at: string;
}

function num(value: number | undefined | null, digits = 4): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function when(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : '—';
}

export default function LaunchpadPage() {
  const campaigns = useApiResource<unknown>('/api/earn/launchpools');
  const [stakes, setStakes] = useState<LaunchpoolStake[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const campaignList = useMemo(() => toArray<LaunchpoolCampaign>(campaigns.data), [campaigns.data]);

  const loadStakes = useCallback(async () => {
    const token = readAuthToken();
    if (!token) {
      setStakes(null);
      return;
    }
    try {
      const response = await fetch('/api/earn/launchpool-stakes', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
      setStakes(Array.isArray(body?.stakes) ? body.stakes : []);
    } catch (err: unknown) {
      setStakes(null);
      setNotice(err instanceof Error ? err.message : 'Stakes could not be loaded');
    }
  }, []);

  useEffect(() => {
    void loadStakes();
  }, [loadStakes]);

  async function stake(campaign: LaunchpoolCampaign) {
    const token = readAuthToken();
    if (!token) {
      setNotice('Sign in to stake in a campaign.');
      return;
    }
    const amount = window.prompt(`Amount of ${campaign.stake_token} to stake (minimum ${campaign.min_stake}):`, String(campaign.min_stake));
    if (amount === null) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value < campaign.min_stake) {
      setNotice(`A stake of at least ${campaign.min_stake} ${campaign.stake_token} is required.`);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/earn/launchpool-stake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: campaign.project_id, amount: value }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
      setNotice('Stake committed. Your balance is locked until the campaign ends.');
      await loadStakes();
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : 'The stake could not be created');
    } finally {
      setBusy(false);
    }
  }

  async function release(stakeId: string) {
    const token = readAuthToken();
    if (!token) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/earn/launchpool-stake', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subscriptionId: stakeId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message ?? `Request failed with status ${response.status}`);
      setNotice('Stake released.');
      await loadStakes();
    } catch (err: unknown) {
      setNotice(err instanceof Error ? err.message : 'The stake could not be released');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0A0A0F] p-4 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Rocket className="h-6 w-6 text-[#FF6B35]" /> Launchpad
            </h1>
            <p className="text-gray-400">Stake for an allocation in the campaigns the operator has opened.</p>
          </div>
          <button
            onClick={() => {
              campaigns.reload();
              void loadStakes();
            }}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {notice && <div className="mb-4 rounded-lg bg-[#FF6B35]/10 px-4 py-2 text-sm text-[#FF6B35]">{notice}</div>}

        {stakes && stakes.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-lg font-semibold">Your stakes</h2>
            <div className="grid gap-3">
              {stakes.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between rounded-xl bg-[#14141A] p-4">
                  <div>
                    <p className="font-medium">{entry.project_id}</p>
                    <p className="text-xs text-gray-500">
                      Staked {num(entry.stake_amount)} · reward {num(entry.reward_amount)} · {entry.claimed ? 'claimed' : 'unclaimed'}
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => release(entry.id)}
                    className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/30 disabled:opacity-50"
                  >
                    Release
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-semibold">Campaigns</h2>
          {campaigns.loading && <p className="text-sm text-gray-500">Loading campaigns…</p>}
          {campaigns.error && <p className="text-sm text-red-400">Could not load campaigns: {campaigns.error}</p>}
          {!campaigns.loading && !campaigns.error && campaignList.length === 0 && (
            <p className="text-sm text-gray-500">No launchpad campaigns are open yet.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {campaignList.map((campaign) => (
              <div key={campaign.id} className="rounded-xl bg-[#14141A] p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{campaign.name}</p>
                  <span className="rounded bg-[#FF6B35]/20 px-2 py-0.5 text-xs capitalize text-[#FF6B35]">
                    {campaign.status}
                  </span>
                </div>
                {campaign.description && <p className="mt-2 text-xs text-gray-400">{campaign.description}</p>}
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400">
                  <div>
                    <dt className="text-gray-500">Stake token</dt>
                    <dd>{campaign.stake_token}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Reward token</dt>
                    <dd>{campaign.reward_token}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">APY</dt>
                    <dd>{(campaign.apy <= 1 ? campaign.apy * 100 : campaign.apy).toFixed(2)}%</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Total rewards</dt>
                    <dd>{num(campaign.total_rewards)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Staked</dt>
                    <dd>{num(campaign.total_staked)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Participants</dt>
                    <dd>{campaign.participants}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-gray-500">
                  {when(campaign.start_time)} → {when(campaign.end_time)}
                </p>
                <button
                  disabled={busy || campaign.status !== 'active'}
                  onClick={() => stake(campaign)}
                  className="mt-3 w-full rounded-lg bg-[#FF6B35] px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {campaign.status === 'active' ? 'Stake' : campaign.status === 'upcoming' ? 'Not started' : 'Closed'}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
