'use client';

/**
 * AdminDashboard - Complete Admin Panel
 * Full administrative interface for exchange management
 */

import React, { useState, useEffect, useMemo } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

// Types
interface User {
  id: string;
  email: string;
  status: 'active' | 'suspended' | 'pending';
  kycLevel: 0 | 1 | 2 | 3;
  createdAt: number;
  lastLogin: number;
  trades24h: number;
  volume24h: number;
  country: string;
  tags: string[];
}

interface Stats {
  totalUsers: number;
  activeUsers24h: number;
  totalVolume24h: number;
  totalFees24h: number;
  openOrders: number;
  pendingWithdrawals: number;
  pendingKYCs: number;
  openDisputes: number;
}

interface PendingKYCs {
  id: string;
  userId: string;
  email: string;
  submittedAt: number;
  docType: string;
  status: 'pending' | 'in_review' | 'approved' | 'rejected';
}

interface WithdrawalRequest {
  id: string;
  userId: string;
  email: string;
  currency: string;
  amount: number;
  address: string;
  status: 'pending' | 'processing' | 'approved' | 'rejected';
  fee: number;
  createdAt: number;
}

interface TradingPair {
  symbol: string;
  base: string;
  quote: string;
  status: 'trading' | 'halted' | 'maintenance';
  makerFee: number;
  takerFee: number;
  minPrice: number;
  maxPrice: number;
  minAmount: number;
  maxAmount: number;
}

// Component: Statistics Overview
const StatsCard = ({ title, value, subtitle, color = 'blue' }: { title: string; value: string | number; subtitle?: string; color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' }) => (
  <div className="bg-gray-800 rounded-lg p-4">
    <div className="text-gray-400 text-xs uppercase">{title}</div>
    <div className={`text-2xl font-bold mt-1 ${color === 'blue' ? 'text-blue-500' : color === 'green' ? 'text-green-500' : color === 'red' ? 'text-red-500' : color === 'yellow' ? 'text-yellow-500' : 'text-purple-500'}`}>{value}</div>
    {subtitle && <div className="text-gray-500 text-xs mt-1">{subtitle}</div>}
  </div>
);

// Component: User Management
const UserManagement = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch('/api/admin/users?limit=100');
        const data = await res.json();
        setUsers(data.users || []);
      } catch (err) {
        console.error('Failed to fetch users:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter(u => !searchQuery || u.email.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [users, searchQuery]);

  const handleUpdateStatus = async (userId: string, newStatus: 'active' | 'suspended') => {
    try {
      await fetch(`/api/admin/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  if (loading) return <div className="text-gray-500 animate-pulse">Loading users...</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-4 mb-4">
        <input
          type="text"
          placeholder="Search by email..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
        />
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-800">
            <tr>
              <th className="text-left p-2 text-gray-400">User</th>
              <th className="text-left p-2 text-gray-400">Status</th>
              <th className="text-left p-2 text-gray-400">KYC</th>
              <th className="text-left p-2 text-gray-400">Country</th>
              <th className="text-right p-2 text-gray-400">Volume 24h</th>
              <th className="text-right p-2 text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map(user => (
              <tr key={user.id} className="border-t border-gray-700 hover:bg-gray-800/50">
                <td className="p-2">
                  <div className="text-white">{user.email}</div>
                  <div className="text-gray-500 text-xs">{user.id}</div>
                </td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    user.status === 'active' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                  }`}>
                    {user.status}
                  </span>
                </td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    user.kycLevel === 3 ? 'bg-green-500/20 text-green-500' : 'bg-gray-500/20 text-gray-500'
                  }`}>
                    Level {user.kycLevel}
                  </span>
                </td>
                <td className="p-2 text-gray-300">{user.country}</td>
                <td className="p-2 text-right text-gray-300">${user.volume24h.toLocaleString()}</td>
                <td className="p-2 text-right">
                  <button onClick={() => handleUpdateStatus(user.id, user.status === 'active' ? 'suspended' : 'active')} className="text-blue-500 hover:text-blue-400">
                    {user.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Component: KYC Review
const KYCReview = () => {
  const [pending, setPending] = useState<PendingKYCs[]>([]);

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await fetch('/api/admin/kyc/pending');
        const data = await res.json();
        setPending(data || []);
      } catch (err) {
        console.error('Failed to fetch pending KYC:', err);
      }
    };
    fetchPending();
  }, []);

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await fetch(`/api/admin/kyc/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setPending(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('KYC review failed:', err);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {pending.length === 0 ? (
        <div className="text-gray-500 text-center py-8">No pending KYC applications</div>
      ) : (
        pending.map(app => (
          <div key={app.id} className="bg-gray-800 rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{app.email}</div>
                <div className="text-gray-400 text-sm">Submitted: {new Date(app.submittedAt * 1000).toLocaleString()}</div>
                <div className="text-gray-400 text-sm">Document: {app.docType}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleReview(app.id, 'approved')} className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600">Approve</button>
                <button onClick={() => handleReview(app.id, 'rejected')} className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600">Reject</button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// Component: Withdrawal Management
const Withdrawals = () => {
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await fetch('/api/admin/withdrawals?status=pending');
        const data = await res.json();
        setRequests(data || []);
      } catch (err) {
        console.error('Failed to fetch withdrawals:', err);
      }
    };
    fetchRequests();
  }, []);

  const handleProcess = async (id: string, action: 'approve' | 'reject') => {
    try {
      await fetch(`/api/admin/withdrawals/${id}/${action}`, { method: 'POST' });
      setRequests(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      console.error('Process failed:', err);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {requests.length === 0 ? (
        <div className="text-gray-500 text-center py-8">No pending withdrawal requests</div>
      ) : (
        requests.map(req => (
          <div key={req.id} className="bg-gray-800 rounded-lg p-4">
            <div className="flex justify-between">
              <div>
                <div className="font-medium">{req.email}</div>
                <div className="text-gray-400 text-sm">Amount: {req.amount} {req.currency}</div>
                <div className="text-gray-500 text-xs">Fee: {req.fee}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleProcess(req.id, 'approve')} className="px-3 py-1 bg-green-500 text-white rounded text-sm">Approve</button>
                <button onClick={() => handleProcess(req.id, 'reject')} className="px-3 py-1 bg-red-500 text-white rounded text-sm">Reject</button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// Component: Trading Pairs Management
const TradingPairs = () => {
  const [pairs, setPairs] = useState<TradingPair[]>([]);

  useEffect(() => {
    const fetchPairs = async () => {
      try {
        const res = await fetch('/api/admin/trading-pairs');
        const data = await res.json();
        setPairs(data || []);
      } catch (err) {
        console.error('Failed to fetch pairs:', err);
      }
    };
    fetchPairs();
  }, []);

  const handleUpdatePair = async (symbol: string, updates: Partial<TradingPair>) => {
    try {
      await fetch(`/api/admin/trading-pairs/${symbol}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      setPairs(prev => prev.map(p => p.symbol === symbol ? { ...p, ...updates } : p));
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-gray-800">
          <tr>
            <th className="text-left p-2 text-gray-400">Pair</th>
            <th className="text-left p-2 text-gray-400">Status</th>
            <th className="text-right p-2 text-gray-400">Maker</th>
            <th className="text-right p-2 text-gray-400">Taker</th>
            <th className="text-right p-2 text-gray-400">Actions</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map(pair => (
            <tr key={pair.symbol} className="border-t border-gray-700">
              <td className="p-2 font-medium">{pair.symbol}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded text-xs ${
                  pair.status === 'trading' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
                }`}>
                  {pair.status}
                </span>
              </td>
              <td className="p-2 text-right">{(pair.makerFee * 100).toFixed(2)}%</td>
              <td className="p-2 text-right">{(pair.takerFee * 100).toFixed(2)}%</td>
              <td className="p-2 text-right">
                <button onClick={() => handleUpdatePair(pair.symbol, { status: pair.status === 'trading' ? 'halted' : 'trading' })} className="text-blue-500 hover:text-blue-400">
                  {pair.status === 'trading' ? 'Halt' : 'Enable'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Component: System Health
const SystemHealth = () => {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/admin/system/health');
        setHealth(await res.json());
      } catch (err) {
        console.error('Failed to fetch health:', err);
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!health) return <div className="text-gray-500 animate-pulse">Loading...</div>;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="text-gray-400 text-xs">CPU Usage</div>
        <div className="text-2xl font-bold text-blue-500">{health.cpuUsage?.toFixed(1)}%</div>
      </div>
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="text-gray-400 text-xs">Memory Usage</div>
        <div className="text-2xl font-bold text-blue-500">{health.memoryUsage?.toFixed(1)}%</div>
      </div>
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="text-gray-400 text-xs">Connections</div>
        <div className="text-2xl font-bold text-blue-500">{health.connections}</div>
      </div>
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="text-gray-400 text-xs">Uptime</div>
        <div className="text-2xl font-bold text-blue-500">{health.uptime}</div>
      </div>
    </div>
  );
};

// Main: Admin Dashboard
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/admin/stats');
        setStats(await res.json());
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'kyc', label: 'KYC Review' },
    { id: 'withdrawals', label: 'Withdrawals' },
    { id: 'pairs', label: 'Trading Pairs' },
    { id: 'system', label: 'System' },
  ];

  return (
    <div className="h-screen flex bg-gray-900 text-white">
      {/* Sidebar */}
      <div className="w-56 border-r border-gray-700 p-4 flex flex-col">
        <div className="text-xl font-bold text-blue-500 mb-6">TigerEx Admin</div>
        <nav className="flex flex-col gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-left rounded text-sm ${
                activeTab === tab.id
                  ? 'bg-blue-500/20 text-blue-500'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {tab.label}
              {(tab.id === 'kyc' || tab.id === 'withdrawals') && stats && tab.id === 'kyc' && stats.pendingKYCs > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-red-500 rounded-full text-xs">{stats.pendingKYCs}</span>
              )}
              {tab.id === 'withdrawals' && stats && stats.pendingWithdrawals > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-yellow-500 rounded-full text-xs">{stats.pendingWithdrawals}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-14 border-b border-gray-700 flex items-center justify-between px-4">
          <h1 className="text-lg font-medium">{tabs.find(t => t.id === activeTab)?.label}</h1>
          <ThemeToggle />
        </div>

        {/* Stats Row (for overview) */}
        {activeTab === 'overview' && stats && (
          <div className="grid grid-cols-4 gap-4 p-4 border-b border-gray-700">
            <StatsCard title="Total Users" value={stats.totalUsers.toLocaleString()} subtitle="Registered" />
            <StatsCard title="Active Users 24h" value={stats.activeUsers24h.toLocaleString()} color="green" />
            <StatsCard title="Volume 24h" value={`$${stats.totalVolume24h.toLocaleString()}`} color="purple" />
            <StatsCard title="Fees 24h" value={`$${stats.totalFees24h.toLocaleString()}`} color="yellow" />
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-4 overflow-auto">
          {activeTab === 'overview' && <SystemHealth />}
          {activeTab === 'overview' && stats && (
            <div className="mt-4 grid grid-cols-4 gap-4 text-center">
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-3xl font-bold text-blue-500">{stats.openOrders}</div>
                <div className="text-gray-400 text-sm">Open Orders</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-3xl font-bold text-yellow-500">{stats.pendingWithdrawals}</div>
                <div className="text-gray-400 text-sm">Pending Withdrawals</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-3xl font-bold text-orange-500">{stats.pendingKYCs}</div>
                <div className="text-gray-400 text-sm">Pending KYC</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="text-3xl font-bold text-red-500">{stats.openDisputes}</div>
                <div className="text-gray-400 text-sm">Open Disputes</div>
              </div>
            </div>
          )}
          {activeTab === 'users' && <UserManagement />}
          {activeTab === 'kyc' && <KYCReview />}
          {activeTab === 'withdrawals' && <Withdrawals />}
          {activeTab === 'pairs' && <TradingPairs />}
          {activeTab === 'system' && <SystemHealth />}
        </div>
      </div>
    </div>
  );
}