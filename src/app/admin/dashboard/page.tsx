'use client';

/**
 * Admin console overview. Every value is read from the admin API service or
 * the admin backend; nothing is generated client-side.
 */

import React, { useMemo, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useApiResource } from '@/lib/useApiResource';

interface UserSummary {
  id: string;
  email: string;
  username: string;
  kycLevel: number;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  locked: boolean;
  createdAt: number;
  lastLoginAt: number;
}

interface ExchangeStats {
  totalUsers?: number;
  activeUsers24h?: number;
  kycLevel1Plus?: number;
  openOrders?: number;
  orders24h?: number;
  pendingWithdrawals?: number;
  pendingDeposits?: number;
  activeMarkets?: number;
  totalVolume24h?: number;
}

interface WithdrawalRecord {
  id: string;
  userId: string;
  asset: string;
  amount: number;
  fee: number;
  netAmount: number;
  address: string;
  status: string;
  createdAt: number;
}

interface MarketRecord {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
  makerFee: number;
  takerFee: number;
}

interface KYCApplication {
  id: string;
  userId: string;
  firstName?: string;
  lastName?: string;
  documentType?: string;
  level: number;
  status: string;
  submittedAt?: number;
}

interface SystemStatus {
  data?: {
    status?: string;
    service?: string;
    uptime?: string;
    goroutines?: number;
    counters?: Record<string, number>;
  };
}

function formatNumber(value: number | undefined, digits = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatTimestamp(value: number | undefined): string {
  if (!value) return '—';
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

const StatsCard = ({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) => (
  <div className="rounded-lg bg-gray-800 p-4">
    <div className="text-xs uppercase text-gray-400">{title}</div>
    <div className="mt-1 text-2xl font-bold text-blue-500">{value}</div>
    {subtitle && <div className="mt-1 text-xs text-gray-500">{subtitle}</div>}
  </div>
);

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg bg-gray-800 p-4">
    <h2 className="mb-3 text-sm font-medium text-gray-300">{title}</h2>
    {children}
  </div>
);

function Overview() {
  const stats = useApiResource<ExchangeStats>('/api/admin/stats');
  const system = useApiResource<SystemStatus>('/api/admin/system/status');

  const loadError = stats.error || system.error;

  return (
    <div className="flex flex-col gap-4">
      {loadError && (
        <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
          Live admin data is unavailable: {loadError}
        </div>
      )}

      {stats.loading ? (
        <p className="text-sm text-gray-500">Loading exchange statistics…</p>
      ) : stats.data ? (
        <div className="grid grid-cols-4 gap-4">
          <StatsCard
            title="Total Users"
            value={formatNumber(stats.data.totalUsers, 0)}
            subtitle="Registered accounts"
          />
          <StatsCard
            title="Active Users 24h"
            value={formatNumber(stats.data.activeUsers24h, 0)}
          />
          <StatsCard title="Orders 24h" value={formatNumber(stats.data.orders24h, 0)} />
          <StatsCard title="Volume 24h" value={formatNumber(stats.data.totalVolume24h, 2)} />
          <StatsCard title="Open Orders" value={formatNumber(stats.data.openOrders, 0)} />
          <StatsCard
            title="Pending Withdrawals"
            value={formatNumber(stats.data.pendingWithdrawals, 0)}
          />
          <StatsCard
            title="Pending Deposits"
            value={formatNumber(stats.data.pendingDeposits, 0)}
          />
          <StatsCard title="Active Markets" value={formatNumber(stats.data.activeMarkets, 0)} />
        </div>
      ) : null}

      <Panel title="Admin Service Runtime">
        {system.loading ? (
          <p className="text-sm text-gray-500">Loading runtime status…</p>
        ) : system.data?.data ? (
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div>
              <div className="text-gray-500">Status</div>
              <div className="font-medium">{system.data.data.status ?? '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">Uptime</div>
              <div className="font-medium">{system.data.data.uptime ?? '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">Goroutines</div>
              <div className="font-medium">{formatNumber(system.data.data.goroutines, 0)}</div>
            </div>
            {Object.entries(system.data.data.counters ?? {}).map(([key, value]) => (
              <div key={key}>
                <div className="text-gray-500">{key.replace(/_/g, ' ')}</div>
                <div className="font-medium">{formatNumber(value, 0)}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Runtime status is not reported.</p>
        )}
      </Panel>
    </div>
  );
}

function UserManagement() {
  const users = useApiResource<{ users?: UserSummary[] }>('/api/admin/users?limit=100');
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const list = useMemo(() => users.data?.users ?? [], [users.data]);
  const filtered = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (user) =>
        user.email.toLowerCase().includes(term) || user.username.toLowerCase().includes(term),
    );
  }, [list, searchQuery]);

  const setStatus = async (userId: string, status: 'active' | 'suspended') => {
    setBusy(userId);
    setMessage(null);
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.success !== false) {
        setMessage(`User set to ${status}.`);
        users.reload();
      } else {
        setMessage(body?.error || `Update failed (${response.status})`);
      }
    } catch {
      setMessage('Status update request failed.');
    } finally {
      setBusy(null);
    }
  };

  if (users.loading) return <p className="text-sm text-gray-500">Loading users…</p>;
  if (users.error) {
    return (
      <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
        Users are unavailable: {users.error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {message && <div className="mb-3 text-sm text-blue-400">{message}</div>}
      <input
        type="text"
        placeholder="Search by email or username…"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        className="mb-4 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
      />
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-800">
            <tr>
              {['User', 'Status', 'KYC', '2FA', 'Created', 'Actions'].map((heading) => (
                <th key={heading} className="p-2 text-left text-gray-400">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  No users match the current filter.
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className="border-t border-gray-700">
                  <td className="p-2">
                    <div className="text-white">{user.email}</div>
                    <div className="text-xs text-gray-500">{user.id}</div>
                  </td>
                  <td className="p-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        user.locked
                          ? 'bg-red-500/20 text-red-500'
                          : 'bg-green-500/20 text-green-500'
                      }`}
                    >
                      {user.locked ? 'suspended' : 'active'}
                    </span>
                  </td>
                  <td className="p-2 text-gray-300">Level {user.kycLevel}</td>
                  <td className="p-2 text-gray-300">{user.twoFactorEnabled ? 'On' : 'Off'}</td>
                  <td className="p-2 text-gray-300">{formatTimestamp(user.createdAt)}</td>
                  <td className="p-2">
                    <button
                      disabled={busy === user.id}
                      onClick={() => setStatus(user.id, user.locked ? 'active' : 'suspended')}
                      className="text-blue-500 hover:text-blue-400 disabled:opacity-50"
                    >
                      {user.locked ? 'Unlock' : 'Suspend'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KYCReview() {
  const queue = useApiResource<{ submissions?: KYCApplication[] }>(
    '/api/admin/kyc?status=pending',
  );
  const pending = useMemo(() => queue.data?.submissions ?? [], [queue.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const review = async (userId: string, approve: boolean) => {
    const reason = approve ? '' : window.prompt('Rejection reason') ?? '';
    if (!approve && !reason.trim()) return;
    setBusy(userId);
    setMessage(null);
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;
      const response = await fetch(`/api/admin/kyc/${encodeURIComponent(userId)}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ approve, level: approve ? 2 : 0, reason }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.success !== false) {
        setMessage(approve ? 'Application approved.' : 'Application rejected.');
        queue.reload();
      } else {
        setMessage(body?.error || `Review failed (${response.status})`);
      }
    } catch {
      setMessage('Review request failed.');
    } finally {
      setBusy(null);
    }
  };

  if (queue.loading) return <p className="text-sm text-gray-500">Loading KYC queue…</p>;
  if (queue.error) {
    return (
      <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
        KYC queue is unavailable: {queue.error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {message && <div className="text-sm text-blue-400">{message}</div>}
      {pending.length === 0 ? (
        <div className="py-8 text-center text-gray-500">No pending KYC applications</div>
      ) : (
        pending.map((app) => (
          <div key={app.id} className="rounded-lg bg-gray-800 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">
                  {[app.firstName, app.lastName].filter(Boolean).join(' ') || app.userId}
                </div>
                <div className="text-sm text-gray-400">User: {app.userId}</div>
                <div className="text-sm text-gray-400">
                  Submitted: {formatTimestamp(app.submittedAt)}
                </div>
                <div className="text-sm text-gray-400">Document: {app.documentType || '—'}</div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={busy === app.userId}
                  onClick={() => review(app.userId, true)}
                  className="rounded bg-green-500 px-3 py-1 text-sm text-white hover:bg-green-600 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busy === app.userId}
                  onClick={() => review(app.userId, false)}
                  className="rounded bg-red-500 px-3 py-1 text-sm text-white hover:bg-red-600 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Withdrawals() {
  const requests = useApiResource<{ withdrawals?: WithdrawalRecord[] }>(
    '/api/admin/withdrawals?status=pending',
  );
  const list = useMemo(() => requests.data?.withdrawals ?? [], [requests.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const process = async (id: string, action: 'approve' | 'reject') => {
    setBusy(id);
    setMessage(null);
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;
      const response = await fetch(`/api/admin/withdrawals/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        setMessage(`Withdrawal ${action}d.`);
        requests.reload();
      } else {
        setMessage(body?.error || `Action failed (${response.status})`);
      }
    } catch {
      setMessage('Withdrawal action failed.');
    } finally {
      setBusy(null);
    }
  };

  if (requests.loading) return <p className="text-sm text-gray-500">Loading withdrawals…</p>;
  if (requests.error) {
    return (
      <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
        Withdrawals are unavailable: {requests.error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {message && <div className="text-sm text-blue-400">{message}</div>}
      {list.length === 0 ? (
        <div className="py-8 text-center text-gray-500">No pending withdrawal requests</div>
      ) : (
        list.map((req) => (
          <div key={req.id} className="rounded-lg bg-gray-800 p-4">
            <div className="flex justify-between">
              <div>
                <div className="font-medium">
                  {formatNumber(req.amount, 8)} {req.asset}
                </div>
                <div className="text-sm text-gray-400">User: {req.userId}</div>
                <div className="text-xs text-gray-500">
                  Address: {req.address} · Fee: {formatNumber(req.fee, 8)} ·{' '}
                  {formatTimestamp(req.createdAt)}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  disabled={busy === req.id}
                  onClick={() => process(req.id, 'approve')}
                  className="rounded bg-green-500 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={busy === req.id}
                  onClick={() => process(req.id, 'reject')}
                  className="rounded bg-red-500 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TradingPairs() {
  const markets = useApiResource<MarketRecord[] | { markets?: MarketRecord[] }>(
    '/api/admin/markets',
  );
  const list = useMemo(() => {
    const payload = markets.data;
    if (Array.isArray(payload)) return payload;
    return payload?.markets ?? [];
  }, [markets.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const toggleStatus = async (symbol: string, current: string) => {
    const next = current === 'trading' ? 'halted' : 'trading';
    setBusy(symbol);
    setMessage(null);
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('tigerex_admin_token') : null;
      const response = await fetch(`/api/admin/markets/${encodeURIComponent(symbol)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: next }),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        setMessage(`${symbol} set to ${next}.`);
        markets.reload();
      } else {
        setMessage(body?.error || `Update failed (${response.status})`);
      }
    } catch {
      setMessage('Market update failed.');
    } finally {
      setBusy(null);
    }
  };

  if (markets.loading) return <p className="text-sm text-gray-500">Loading markets…</p>;
  if (markets.error) {
    return (
      <div className="rounded-lg border border-amber-700 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
        Markets are unavailable: {markets.error}
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      {message && <div className="mb-3 text-sm text-blue-400">{message}</div>}
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-gray-800">
          <tr>
            {['Pair', 'Status', 'Maker', 'Taker', 'Actions'].map((heading) => (
              <th key={heading} className="p-2 text-left text-gray-400">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-6 text-center text-gray-500">
                No markets are listed.
              </td>
            </tr>
          ) : (
            list.map((pair) => (
              <tr key={pair.id || pair.symbol} className="border-t border-gray-700">
                <td className="p-2 font-medium">{pair.symbol}</td>
                <td className="p-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      pair.status === 'trading'
                        ? 'bg-green-500/20 text-green-500'
                        : 'bg-red-500/20 text-red-500'
                    }`}
                  >
                    {pair.status}
                  </span>
                </td>
                <td className="p-2">{(pair.makerFee * 100).toFixed(4)}%</td>
                <td className="p-2">{(pair.takerFee * 100).toFixed(4)}%</td>
                <td className="p-2">
                  <button
                    disabled={busy === pair.symbol}
                    onClick={() => toggleStatus(pair.symbol, pair.status)}
                    className="text-blue-500 hover:text-blue-400 disabled:opacity-50"
                  >
                    {pair.status === 'trading' ? 'Halt' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'kyc', label: 'KYC Review' },
    { id: 'withdrawals', label: 'Withdrawals' },
    { id: 'pairs', label: 'Trading Pairs' },
    { id: 'system', label: 'System' },
  ];

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      <div className="flex w-56 flex-col border-r border-gray-700 p-4">
        <div className="mb-6 text-xl font-bold text-blue-500">TigerEx Admin</div>
        <nav className="flex flex-col gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-3 py-2 text-left text-sm ${
                activeTab === tab.id
                  ? 'bg-blue-500/20 text-blue-500'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-14 items-center justify-between border-b border-gray-700 px-4">
          <h1 className="text-lg font-medium">
            {tabs.find((tab) => tab.id === activeTab)?.label}
          </h1>
          <ThemeToggle />
        </div>

        <div className="flex-1 overflow-auto p-4">
          {activeTab === 'overview' && <Overview />}
          {activeTab === 'users' && <UserManagement />}
          {activeTab === 'kyc' && <KYCReview />}
          {activeTab === 'withdrawals' && <Withdrawals />}
          {activeTab === 'pairs' && <TradingPairs />}
          {activeTab === 'system' && <Overview />}
        </div>
      </div>
    </div>
  );
}
