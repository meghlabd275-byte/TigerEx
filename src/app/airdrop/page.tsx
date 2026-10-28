'use client';

/**
 * Airdrop and launchpool centre. Campaigns and the signed-in user's stakes are
 * read from the earn service; nothing is generated in the browser.
 */

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface Launchpool {
  id: string;
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

function formatNumber(value: number | undefined, digits = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export default function AirdropPage() {
  const campaigns = useApiResource<{ data?: Launchpool[] }>('/api/earn/launchpools');
  const list = useMemo(() => campaigns.data?.data ?? [], [campaigns.data]);

  const [stakes, setStakes] = useState<LaunchpoolStake[]>([]);
  const [stakesError, setStakesError] = useState<string | null>(null);
  const [stakesLoading, setStakesLoading] = useState(true);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const authToken = () =>
    typeof window !== 'undefined' ? localStorage.getItem('tigerex_access_token') : null;

  useEffect(() => {
    const load = async () => {
      setStakesLoading(true);
      setStakesError(null);
      try {
        const me = await fetch('/api/auth/me', {
          headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {},
        });
        if (!me.ok) {
          setStakesError('Sign in to see your airdrop history.');
          setStakes([]);
          return;
        }
        const profile = await me.json().catch(() => null);
        const userId = profile?.user?.userId || profile?.user?.id || profile?.userId;
        if (!userId) {
          setStakesError('Sign in to see your airdrop history.');
          setStakes([]);
          return;
        }
        const response = await fetch(
          `/api/earn/launchpool-stakes?userId=${encodeURIComponent(userId)}`,
          { headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {} },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          setStakesError(payload?.error || 'Airdrop history is unavailable.');
          setStakes([]);
          return;
        }
        setStakes(payload?.data ?? []);
      } catch {
        setStakesError('Airdrop history could not be loaded.');
        setStakes([]);
      } finally {
        setStakesLoading(false);
      }
    };
    void load();
  }, []);

  const join = async (project: Launchpool) => {
    const input = window.prompt(`Amount of ${project.stake_token} to stake`);
    const amount = Number(input);
    if (!input || !Number.isFinite(amount) || amount < project.min_stake) {
      setMessage({
        ok: false,
        text: `Enter an amount of at least ${project.min_stake} ${project.stake_token}.`,
      });
      return;
    }

    setBusy(project.id);
    setMessage(null);
    try {
      const me = await fetch('/api/auth/me', {
        headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : {},
      });
      const profile = await me.json().catch(() => null);
      const userId = profile?.user?.userId || profile?.user?.id || profile?.userId;
      if (!userId) {
        setMessage({ ok: false, text: 'Sign in before joining an airdrop.' });
        return;
      }

      const response = await fetch('/api/earn/launchpool-stake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken() ? { Authorization: `Bearer ${authToken()}` } : {}),
        },
        body: JSON.stringify({ user_id: userId, project_id: project.id, amount }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success !== false) {
        setMessage({ ok: true, text: `Staked ${amount} ${project.stake_token}.` });
        campaigns.reload();
      } else {
        setMessage({ ok: false, text: payload?.error || 'Stake request was rejected.' });
      }
    } catch {
      setMessage({ ok: false, text: 'Stake request failed.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Airdrop Center</h1>
          <button
            onClick={campaigns.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {message && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              message.ok
                ? 'border border-green-200 bg-green-50 text-green-800'
                : 'border border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        {campaigns.loading && <p className="text-sm text-gray-500">Loading campaigns…</p>}
        {campaigns.error && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Campaigns are unavailable: {campaigns.error}
          </div>
        )}

        {!campaigns.loading && !campaigns.error && (
          <div className="mb-6">
            <h2 className="mb-4 text-lg font-semibold">Active Campaigns</h2>
            {list.length === 0 ? (
              <div className="rounded-lg bg-white p-6 text-center text-gray-500 shadow">
                No launchpool campaigns are currently running.
              </div>
            ) : (
              <div className="space-y-4">
                {list.map((project) => (
                  <div key={project.id} className="rounded-lg bg-white p-4 shadow">
                    <div className="mb-2 flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">{project.name}</h3>
                        <p className="text-sm text-gray-500">{project.description}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${
                          project.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : project.status === 'upcoming'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {project.status}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Reward:</span>
                          <span className="ml-1 font-semibold">
                            {formatNumber(project.total_rewards, 4)} {project.reward_token}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Stake:</span>
                          <span className="ml-1 font-semibold">{project.stake_token}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">APY:</span>
                          <span className="ml-1 font-semibold">{project.apy}%</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Participants:</span>
                          <span className="ml-1 font-semibold">
                            {formatNumber(project.participants, 0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Ends:</span>
                          <span className="ml-1 font-semibold">{formatDate(project.end_time)}</span>
                        </div>
                      </div>
                      {project.status === 'active' && (
                        <button
                          onClick={() => join(project)}
                          disabled={busy === project.id}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {busy === project.id ? 'Staking…' : 'Join'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold">My Airdrop History</h2>
          {stakesLoading && <p className="text-sm text-gray-500">Loading your stakes…</p>}
          {!stakesLoading && stakesError && (
            <p className="text-sm text-amber-700">{stakesError}</p>
          )}
          {!stakesLoading && !stakesError && stakes.length === 0 && (
            <p className="text-sm text-gray-500">You have not joined any campaign yet.</p>
          )}
          {!stakesLoading && !stakesError && stakes.length > 0 && (
            <div className="space-y-3">
              {stakes.map((stake) => {
                const project = list.find((item) => item.id === stake.project_id);
                return (
                  <div
                    key={stake.id}
                    className="flex items-center justify-between rounded-lg bg-gray-50 p-3"
                  >
                    <div>
                      <div className="font-medium">{project?.name ?? stake.project_id}</div>
                      <div className="text-sm text-gray-500">
                        Staked {formatNumber(stake.stake_amount, 4)}{' '}
                        {project?.stake_token ?? ''} · Reward {formatNumber(stake.reward_amount, 4)}{' '}
                        {project?.reward_token ?? ''}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        stake.claimed
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {stake.claimed ? 'claimed' : 'pending'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
