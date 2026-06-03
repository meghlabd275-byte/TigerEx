// =============================================================================
// TIGEREX v3.0 - ADMIN DASHBOARD
// Complete admin panel with all management features
// =============================================================================

import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard, Users, Wallet, Shield, BarChart3, Settings,
  Bell, Search, Filter, Download, Upload, RefreshCw, ChevronDown,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle, Clock,
  DollarSign, Activity, Globe, Key, FileText, PieChart, ArrowUpRight,
  ArrowDownRight, Eye, Edit, Trash2, Ban, Check, X, Plus, Minus,
  CreditCard, Building, Wallet as WalletIcon, History, FileCheck,
  AlertCircle, Info, Warning, Lock, Unlock, UserCheck, UserX
} from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  verifiedUsers: number;
  totalVolume24h: number;
  totalTrades24h: number;
  totalFees24h: number;
  openOrders: number;
  pendingWithdrawals: number;
  pendingKYC: number;
  openAlerts: number;
}

interface UserRecord {
  userId: string;
  email: string;
  username: string;
  kycLevel: 'none' | 'basic' | 'intermediate' | 'advanced' | 'institutional';
  kycStatus: 'pending' | 'in_review' | 'approved' | 'rejected' | 'expired';
  status: 'active' | 'suspended' | 'locked' | 'closed';
  createdAt: string;
  lastLogin: string;
  country: string;
  riskScore: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalVolume: number;
}

interface KYCRecord {
  kycId: string;
  userId: string;
  userEmail: string;
  level: number;
  status: string;
  submittedAt: string;
  reviewerId?: string;
  reviewerNotes?: string;
}

interface AlertRecord {
  alertId: string;
  userId: string;
  userEmail: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  description: string;
  createdAt: string;
  assignedTo?: string;
}

interface TransactionRecord {
  txId: string;
  userId: string;
  type: 'deposit' | 'withdrawal' | 'internal';
  currency: string;
  amount: number;
  fee: number;
  status: string;
  createdAt: string;
  txHash?: string;
  address?: string;
}

interface MarketConfig {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: 'trading' | 'halt' | 'maintenance';
  makerFee: number;
  takerFee: number;
  minPrice: number;
  maxPrice: number;
  tickSize: number;
  lotSize: number;
  minQty: number;
  maxQty: number;
}

// =============================================================================
// DASHBOARD OVERVIEW COMPONENT
// =============================================================================

const DashboardOverview: React.FC = () => {
  const [stats, setStats] = useState<AdminStats>({
    totalUsers: 0,
    activeUsers: 0,
    verifiedUsers: 0,
    totalVolume24h: 0,
    totalTrades24h: 0,
    totalFees24h: 0,
    openOrders: 0,
    pendingWithdrawals: 0,
    pendingKYC: 0,
    openAlerts: 0,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate API call
    setTimeout(() => {
      setStats({
        totalUsers: 125847,
        activeUsers: 89234,
        verifiedUsers: 67543,
        totalVolume24h: 2850000000,
        totalTrades24h: 1523847,
        totalFees24h: 2850000,
        openOrders: 45892,
        pendingWithdrawals: 1234,
        pendingKYC: 567,
        openAlerts: 89,
      });
      setLoading(false);
    }, 500);
  }, []);

  const StatCard: React.FC<{
    title: string;
    value: string;
    change?: string;
    icon: React.ElementType;
    color: string;
  }> = ({ title, value, change, icon: Icon, color }) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {change && (
          <span className={`text-xs font-medium ${change.startsWith('+') ? 'text-green-500' : 'text-red-500'}`}>
            {change}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{value}</div>
      <div className="text-sm text-gray-500">{title}</div>
    </div>
  );

  const formatNumber = (num: number): string => {
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Users"
          value={stats.totalUsers.toLocaleString()}
          change="+12.5%"
          icon={Users}
          color="bg-blue-500"
        />
        <StatCard
          title="24h Volume"
          value={`$${formatNumber(stats.totalVolume24h)}`}
          change="+8.3%"
          icon={DollarSign}
          color="bg-green-500"
        />
        <StatCard
          title="24h Trades"
          value={stats.totalTrades24h.toLocaleString()}
          change="+15.2%"
          icon={Activity}
          color="bg-purple-500"
        />
        <StatCard
          title="24h Fees"
          value={`$${formatNumber(stats.totalFees24h)}`}
          change="+5.7%"
          icon={TrendingUp}
          color="bg-orange-500"
        />
      </div>

      {/* Alerts & Pending */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-6 border border-red-200 dark:border-red-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-red-500 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.openAlerts}</div>
              <div className="text-sm text-red-500">Open Alerts</div>
            </div>
          </div>
          <button className="w-full py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium">
            View Alerts
          </button>
        </div>

        <div className="bg-yellow-50 dark:bg-yellow-900/10 rounded-xl p-6 border border-yellow-200 dark:border-yellow-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-yellow-500 flex items-center justify-center">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.pendingKYC}</div>
              <div className="text-sm text-yellow-500">Pending KYC</div>
            </div>
          </div>
          <button className="w-full py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 text-sm font-medium">
            Review KYC
          </button>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
              <WalletIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.pendingWithdrawals}</div>
              <div className="text-sm text-blue-500">Pending Withdrawals</div>
            </div>
          </div>
          <button className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium">
            Process Withdrawals
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[
            { label: 'Add Market', icon: Plus, color: 'bg-green-500' },
            { label: 'Pause Trading', icon: Pause, color: 'bg-yellow-500' },
            { label: 'Update Fees', icon: DollarSign, color: 'bg-blue-500' },
            { label: 'Send Notification', icon: Bell, color: 'bg-purple-500' },
            { label: 'Export Report', icon: Download, color: 'bg-gray-500' },
            { label: 'System Health', icon: Activity, color: 'bg-orange-500' },
          ].map((action) => (
            <button
              key={action.label}
              className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${action.color}`}>
                <action.icon className="w-5 h-5 text-white" />
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Activity</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200 dark:border-gray-700">
                <th className="py-3 px-4 text-left">Time</th>
                <th className="py-3 px-4 text-left">Event</th>
                <th className="py-3 px-4 text-left">User</th>
                <th className="py-3 px-4 text-left">Details</th>
                <th className="py-3 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {[
                { time: '2 min ago', event: 'User KYC Approved', user: 'user@example.com', details: 'Intermediate verification', status: 'success' },
                { time: '5 min ago', event: 'Large Withdrawal', user: 'user2@example.com', details: '$50,000 USDT', status: 'pending' },
                { time: '8 min ago', event: 'AML Alert Triggered', user: 'user3@example.com', details: 'Unusual trading pattern', status: 'warning' },
                { time: '12 min ago', event: 'New User Registered', user: 'user4@example.com', details: 'From USA', status: 'info' },
                { time: '15 min ago', event: 'Market Paused', user: 'System', details: 'BTC/USDT maintenance', status: 'warning' },
              ].map((activity, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="py-3 px-4 text-gray-500">{activity.time}</td>
                  <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{activity.event}</td>
                  <td className="py-3 px-4 text-gray-600 dark:text-gray-400">{activity.user}</td>
                  <td className="py-3 px-4 text-gray-500">{activity.details}</td>
                  <td className="py-3 px-4 text-right">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      activity.status === 'success' ? 'bg-green-100 text-green-600' :
                      activity.status === 'warning' ? 'bg-yellow-100 text-yellow-600' :
                      activity.status === 'pending' ? 'bg-blue-100 text-blue-600' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {activity.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// USER MANAGEMENT COMPONENT
// =============================================================================

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);

  useEffect(() => {
    // Mock data
    setUsers([
      {
        userId: 'usr_001',
        email: 'john.trader@example.com',
        username: 'johntrader',
        kycLevel: 'intermediate',
        kycStatus: 'approved',
        status: 'active',
        createdAt: '2024-01-15T10:30:00Z',
        lastLogin: '2024-06-03T08:45:00Z',
        country: 'United States',
        riskScore: 15,
        totalDeposits: 125000,
        totalWithdrawals: 98000,
        totalVolume: 2450000,
      },
      {
        userId: 'usr_002',
        email: 'sarah.crypto@example.com',
        username: 'sarahcrypto',
        kycLevel: 'advanced',
        kycStatus: 'approved',
        status: 'active',
        createdAt: '2024-02-20T14:20:00Z',
        lastLogin: '2024-06-03T12:30:00Z',
        country: 'Singapore',
        riskScore: 8,
        totalDeposits: 500000,
        totalWithdrawals: 450000,
        totalVolume: 12500000,
      },
      {
        userId: 'usr_003',
        email: 'mike.hodler@example.com',
        username: 'mikeh',
        kycLevel: 'basic',
        kycStatus: 'pending',
        status: 'active',
        createdAt: '2024-06-01T09:00:00Z',
        lastLogin: '2024-06-03T10:15:00Z',
        country: 'Germany',
        riskScore: 25,
        totalDeposits: 5000,
        totalWithdrawals: 0,
        totalVolume: 15000,
      },
    ]);
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = 
        user.email.toLowerCase().includes(search.toLowerCase()) ||
        user.username.toLowerCase().includes(search.toLowerCase()) ||
        user.userId.toLowerCase().includes(search.toLowerCase());
      
      const matchesFilter = 
        filter === 'all' ||
        (filter === 'verified' && user.kycStatus === 'approved') ||
        (filter === 'pending' && user.kycStatus === 'pending') ||
        (filter === 'suspended' && user.status === 'suspended');
      
      return matchesSearch && matchesFilter;
    });
  }, [users, search, filter]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
      case 'approved':
        return 'bg-green-100 text-green-600';
      case 'pending':
      case 'in_review':
        return 'bg-yellow-100 text-yellow-600';
      case 'suspended':
      case 'rejected':
        return 'bg-red-100 text-red-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">User Management</h2>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm w-64"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
          >
            <option value="all">All Users</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending KYC</option>
            <option value="suspended">Suspended</option>
          </select>
          <button className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr className="text-gray-500">
                <th className="py-3 px-4 text-left">User</th>
                <th className="py-3 px-4 text-left">KYC</th>
                <th className="py-3 px-4 text-left">Status</th>
                <th className="py-3 px-4 text-left">Country</th>
                <th className="py-3 px-4 text-right">Volume</th>
                <th className="py-3 px-4 text-right">Risk</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredUsers.map((user) => (
                <tr key={user.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="py-3 px-4">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{user.username}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(user.kycStatus)}`}>
                      {user.kycLevel} - {user.kycStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(user.status)}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-600 dark:text-gray-400">{user.country}</td>
                  <td className="py-3 px-4 text-right font-medium text-gray-900 dark:text-white">
                    ${user.totalVolume.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.riskScore < 30 ? 'bg-green-100 text-green-600' :
                      user.riskScore < 60 ? 'bg-yellow-100 text-yellow-600' :
                      'bg-red-100 text-red-600'
                    }`}>
                      {user.riskScore}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedUser(user)}
                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4 text-gray-500" />
                      </button>
                      <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" title="Edit">
                        <Edit className="w-4 h-4 text-gray-500" />
                      </button>
                      <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" title="Suspend">
                        <Ban className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Detail Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">User Details</h3>
              <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="text-xs text-gray-500">User ID</label>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{selectedUser.userId}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Email</label>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{selectedUser.email}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Username</label>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{selectedUser.username}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Country</label>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{selectedUser.country}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500">KYC Level</label>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{selectedUser.kycLevel}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Status</label>
                <div className="text-sm font-medium text-gray-900 dark:text-white">{selectedUser.status}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Total Deposits</label>
                <div className="text-sm font-medium text-green-600">${selectedUser.totalDeposits.toLocaleString()}</div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Total Withdrawals</label>
                <div className="text-sm font-medium text-red-600">${selectedUser.totalWithdrawals.toLocaleString()}</div>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-500">Total Volume</label>
                <div className="text-sm font-medium text-gray-900 dark:text-white">${selectedUser.totalVolume.toLocaleString()}</div>
              </div>
            </div>
            <div className="flex gap-4 mt-6">
              <button className="flex-1 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">
                View Full History
              </button>
              <button className="flex-1 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium">
                Suspend User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// KYC REVIEW COMPONENT
// =============================================================================

const KYCReview: React.FC = () => {
  const [kycRecords, setKycRecords] = useState<KYCRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<KYCRecord | null>(null);

  useEffect(() => {
    setKycRecords([
      { kycId: 'kyc_001', userId: 'usr_003', userEmail: 'mike.hodler@example.com', level: 1, status: 'pending', submittedAt: '2024-06-01T09:00:00Z' },
      { kycId: 'kyc_002', userId: 'usr_004', userEmail: 'lisa.investor@example.com', level: 2, status: 'in_review', submittedAt: '2024-05-30T14:30:00Z', reviewerId: 'admin_01' },
      { kycId: 'kyc_003', userId: 'usr_005', userEmail: 'alex.trade@example.com', level: 1, status: 'pending', submittedAt: '2024-06-02T11:20:00Z' },
    ]);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">KYC Review Queue</h2>
        <div className="text-sm text-gray-500">{kycRecords.filter(r => r.status === 'pending').length} pending reviews</div>
      </div>

      <div className="grid gap-4">
        {kycRecords.map((record) => (
          <div
            key={record.kycId}
            className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                  <UserCheck className="w-6 h-6 text-gray-500" />
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{record.userEmail}</div>
                  <div className="text-sm text-gray-500">
                    Level {record.level} • Submitted {new Date(record.submittedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  record.status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                  record.status === 'in_review' ? 'bg-blue-100 text-blue-600' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {record.status}
                </span>
                <button
                  onClick={() => setSelectedRecord(record)}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium"
                >
                  Review
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">KYC Review - {selectedRecord.userEmail}</h3>
              <button onClick={() => setSelectedRecord(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Document Preview Placeholder */}
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
                <FileCheck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-sm text-gray-500">ID Document Front</p>
              </div>
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
                <FileCheck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-sm text-gray-500">ID Document Back</p>
              </div>
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
                <FileCheck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-sm text-gray-500">Selfie with Document</p>
              </div>
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center">
                <FileCheck className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-sm text-gray-500">Address Proof</p>
              </div>
            </div>

            {/* AML Check Results */}
            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 mb-6">
              <h4 className="font-medium text-gray-900 dark:text-white mb-3">AML Check Results</h4>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">Pass</div>
                  <div className="text-xs text-gray-500">PEP Check</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">Pass</div>
                  <div className="text-xs text-gray-500">Sanctions</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">Pass</div>
                  <div className="text-xs text-gray-500">Adverse Media</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">25</div>
                  <div className="text-xs text-gray-500">Risk Score</div>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="mb-6">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Reviewer Notes</label>
              <textarea
                className="w-full px-4 py-3 bg-gray-100 dark:bg-gray-900 border-0 rounded-lg text-sm"
                rows={3}
                placeholder="Add notes about this KYC submission..."
              />
            </div>

            {/* Actions */}
            <div className="flex gap-4">
              <button className="flex-1 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium flex items-center justify-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Approve
              </button>
              <button className="flex-1 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium flex items-center justify-center gap-2">
                <XCircle className="w-5 h-5" />
                Reject
              </button>
              <button className="flex-1 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 font-medium flex items-center justify-center gap-2">
                <Clock className="w-5 h-5" />
                Request More Info
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// COMPLIANCE & ALERTS COMPONENT
// =============================================================================

const ComplianceAlerts: React.FC = () => {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);

  useEffect(() => {
    setAlerts([
      { alertId: 'alert_001', userId: 'usr_010', userEmail: 'suspicious@example.com', type: 'large_deposit', severity: 'high', status: 'open', description: 'Deposited $100,000 USDT from new address', createdAt: '2024-06-03T10:30:00Z' },
      { alertId: 'alert_002', userId: 'usr_011', userEmail: 'trader22@example.com', type: 'unusual_trading', severity: 'medium', status: 'investigating', description: 'Unusual trading pattern detected - high frequency wash trading', createdAt: '2024-06-03T09:15:00Z', assignedTo: 'compliance_01' },
      { alertId: 'alert_003', userId: 'usr_012', userEmail: 'newuser@example.com', type: 'kyc_mismatch', severity: 'low', status: 'open', description: 'Name on document does not match account name', createdAt: '2024-06-02T16:45:00Z' },
    ]);
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-red-100 text-red-600';
      case 'medium': return 'bg-yellow-100 text-yellow-600';
      case 'low': return 'bg-blue-100 text-blue-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Compliance Alerts</h2>
        <div className="flex items-center gap-4">
          <span className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-sm font-medium">
            {alerts.filter(a => a.status === 'open').length} Open
          </span>
          <span className="px-3 py-1 bg-yellow-100 text-yellow-600 rounded-full text-sm font-medium">
            {alerts.filter(a => a.status === 'investigating').length} Investigating
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {alerts.map((alert) => (
          <div
            key={alert.alertId}
            className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  alert.severity === 'high' || alert.severity === 'critical' ? 'bg-red-500' : 'bg-yellow-500'
                }`}>
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">{alert.userEmail}</div>
                  <div className="text-sm text-gray-500">{alert.userId}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getSeverityColor(alert.severity)}`}>
                  {alert.severity}
                </span>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  alert.status === 'open' ? 'bg-red-100 text-red-600' :
                  alert.status === 'investigating' ? 'bg-yellow-100 text-yellow-600' :
                  'bg-green-100 text-green-600'
                }`}>
                  {alert.status}
                </span>
              </div>
            </div>
            <div className="mb-4">
              <div className="text-sm text-gray-500 mb-1">Type: {alert.type}</div>
              <div className="text-sm text-gray-700 dark:text-gray-300">{alert.description}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-500">
                Created: {new Date(alert.createdAt).toLocaleString()}
                {alert.assignedTo && ` • Assigned to: ${alert.assignedTo}`}
              </div>
              <div className="flex gap-2">
                {alert.status === 'open' && (
                  <>
                    <button className="px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-xs font-medium">
                      Assign to Me
                    </button>
                    <button className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 text-xs font-medium">
                      Mark False Positive
                    </button>
                  </>
                )}
                {alert.status === 'investigating' && (
                  <button className="px-3 py-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 text-xs font-medium">
                    Resolve
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// =============================================================================
// MARKET MANAGEMENT COMPONENT
// =============================================================================

const MarketManagement: React.FC = () => {
  const [markets, setMarkets] = useState<MarketConfig[]>([]);

  useEffect(() => {
    setMarkets([
      { symbol: 'BTC/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'trading', makerFee: 0.001, takerFee: 0.002, minPrice: 0.01, maxPrice: 1000000, tickSize: 0.01, lotSize: 0.00001, minQty: 0.00001, maxQty: 9000 },
      { symbol: 'ETH/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', status: 'trading', makerFee: 0.001, takerFee: 0.002, minPrice: 0.01, maxPrice: 100000, tickSize: 0.01, lotSize: 0.0001, minQty: 0.0001, maxQty: 9000 },
      { symbol: 'BNB/USDT', baseAsset: 'BNB', quoteAsset: 'USDT', status: 'trading', makerFee: 0.001, takerFee: 0.002, minPrice: 0.01, maxPrice: 10000, tickSize: 0.01, lotSize: 0.001, minQty: 0.001, maxQty: 9000 },
      { symbol: 'SOL/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', status: 'trading', makerFee: 0.001, takerFee: 0.002, minPrice: 0.01, maxPrice: 10000, tickSize: 0.01, lotSize: 0.01, minQty: 0.01, maxQty: 9000 },
      { symbol: 'XRP/USDT', baseAsset: 'XRP', quoteAsset: 'USDT', status: 'halt', makerFee: 0.001, takerFee: 0.002, minPrice: 0.0001, maxPrice: 100, tickSize: 0.0001, lotSize: 0.1, minQty: 0.1, maxQty: 9000000 },
    ]);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Market Management</h2>
        <button className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Market
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr className="text-gray-500">
                <th className="py-3 px-4 text-left">Symbol</th>
                <th className="py-3 px-4 text-left">Assets</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Maker Fee</th>
                <th className="py-3 px-4 text-right">Taker Fee</th>
                <th className="py-3 px-4 text-center">Tick Size</th>
                <th className="py-3 px-4 text-center">Lot Size</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {markets.map((market) => (
                <tr key={market.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{market.symbol}</td>
                  <td className="py-3 px-4 text-gray-600 dark:text-gray-400">{market.baseAsset}/{market.quoteAsset}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      market.status === 'trading' ? 'bg-green-100 text-green-600' :
                      market.status === 'halt' ? 'bg-red-100 text-red-600' :
                      'bg-yellow-100 text-yellow-600'
                    }`}>
                      {market.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-400">{(market.makerFee * 100).toFixed(2)}%</td>
                  <td className="py-3 px-4 text-right text-gray-600 dark:text-gray-400">{(market.takerFee * 100).toFixed(2)}%</td>
                  <td className="py-3 px-4 text-center text-gray-600 dark:text-gray-400">{market.tickSize}</td>
                  <td className="py-3 px-4 text-center text-gray-600 dark:text-gray-400">{market.lotSize}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" title="Edit">
                        <Edit className="w-4 h-4 text-gray-500" />
                      </button>
                      <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" title={market.status === 'trading' ? 'Halt' : 'Resume'}>
                        {market.status === 'trading' ? <Pause className="w-4 h-4 text-red-500" /> : <Play className="w-4 h-4 text-green-500" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// FEE MANAGEMENT COMPONENT
// =============================================================================

const FeeManagement: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Fee Management</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Spot Trading Fees */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Spot Trading Fees</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div>
                <div className="font-medium text-gray-900 dark:text-white">Maker Fee</div>
                <div className="text-sm text-gray-500">Limit orders</div>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" defaultValue="0.10" className="w-20 px-3 py-2 bg-white dark:bg-gray-800 border rounded-lg text-center" />
                <span className="text-gray-500">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div>
                <div className="font-medium text-gray-900 dark:text-white">Taker Fee</div>
                <div className="text-sm text-gray-500">Market orders</div>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" defaultValue="0.20" className="w-20 px-3 py-2 bg-white dark:bg-gray-800 border rounded-lg text-center" />
                <span className="text-gray-500">%</span>
              </div>
            </div>
          </div>
          <button className="w-full mt-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">
            Update Spot Fees
          </button>
        </div>

        {/* Futures Fees */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Futures Trading Fees</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div>
                <div className="font-medium text-gray-900 dark:text-white">Maker Fee</div>
                <div className="text-sm text-gray-500">Limit orders</div>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" defaultValue="0.02" className="w-20 px-3 py-2 bg-white dark:bg-gray-800 border rounded-lg text-center" />
                <span className="text-gray-500">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div>
                <div className="font-medium text-gray-900 dark:text-white">Taker Fee</div>
                <div className="text-sm text-gray-500">Market orders</div>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" defaultValue="0.04" className="w-20 px-3 py-2 bg-white dark:bg-gray-800 border rounded-lg text-center" />
                <span className="text-gray-500">%</span>
              </div>
            </div>
          </div>
          <button className="w-full mt-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">
            Update Futures Fees
          </button>
        </div>

        {/* Withdrawal Fees */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Withdrawal Fees</h3>
          <div className="space-y-3">
            {['BTC', 'ETH', 'USDT', 'BNB', 'SOL'].map((asset) => (
              <div key={asset} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <span className="font-medium text-gray-900 dark:text-white">{asset}</span>
                <div className="flex items-center gap-2">
                  <input type="number" defaultValue={asset === 'BTC' ? '0.0005' : asset === 'ETH' ? '0.005' : '1'} className="w-24 px-3 py-2 bg-white dark:bg-gray-800 border rounded-lg text-center text-sm" />
                  <span className="text-gray-500 text-sm">{asset}</span>
                </div>
              </div>
            ))}
          </div>
          <button className="w-full mt-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-medium">
            Update Withdrawal Fees
          </button>
        </div>

        {/* VIP Tiers */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">VIP Fee Tiers</h3>
          <div className="space-y-3">
            {[
              { name: 'Regular', maker: '0.10%', taker: '0.20%', volume: '$0' },
              { name: 'VIP 1', maker: '0.08%', taker: '0.16%', volume: '$100K' },
              { name: 'VIP 2', maker: '0.06%', taker: '0.12%', volume: '$1M' },
              { name: 'VIP 3', maker: '0.04%', taker: '0.08%', volume: '$10M' },
              { name: 'VIP 4', maker: '0.02%', taker: '0.04%', volume: '$100M' },
            ].map((tier) => (
              <div key={tier.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">{tier.name}</span>
                  <span className="text-xs text-gray-500 ml-2">Min: {tier.volume}</span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">M: {tier.maker}</span>
                  <span className="text-gray-600 dark:text-gray-400">T: {tier.taker}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// ANALYTICS COMPONENT
// =============================================================================

const AnalyticsDashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Analytics Dashboard</h2>
        <div className="flex items-center gap-4">
          <select className="px-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm">
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
            <option>This year</option>
          </select>
          <button className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export Report
          </button>
        </div>
      </div>

      {/* Charts Placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Trading Volume</h3>
          <div className="h-64 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <BarChart3 className="w-16 h-16 mx-auto mb-2 opacity-50" />
              <p>Volume chart placeholder</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">User Growth</h3>
          <div className="h-64 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Users className="w-16 h-16 mx-auto mb-2 opacity-50" />
              <p>User growth chart placeholder</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Revenue Breakdown</h3>
          <div className="h-64 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <PieChart className="w-16 h-16 mx-auto mb-2 opacity-50" />
              <p>Revenue pie chart placeholder</p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Fee Revenue</h3>
          <div className="h-64 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <TrendingUp className="w-16 h-16 mx-auto mb-2 opacity-50" />
              <p>Fee revenue chart placeholder</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// MAIN ADMIN DASHBOARD COMPONENT
// =============================================================================

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'users', label: 'User Management', icon: Users },
    { id: 'kyc', label: 'KYC Review', icon: Shield },
    { id: 'compliance', label: 'Compliance', icon: AlertTriangle },
    { id: 'markets', label: 'Markets', icon: Activity },
    { id: 'fees', label: 'Fee Management', icon: DollarSign },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardOverview />;
      case 'users':
        return <UserManagement />;
      case 'kyc':
        return <KYCReview />;
      case 'compliance':
        return <ComplianceAlerts />;
      case 'markets':
        return <MarketManagement />;
      case 'fees':
        return <FeeManagement />;
      case 'analytics':
        return <AnalyticsDashboard />;
      default:
        return <DashboardOverview />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg lg:hidden"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">T</span>
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-white">TigerEx Admin</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Bell className="w-5 h-5 text-gray-500" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-xs text-white flex items-center justify-center">3</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gray-300 rounded-full" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Admin User</span>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:static lg:block`}>
          <nav className="p-4 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  activeTab === item.id
                    ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {renderContent()}
        </main>
      </div>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}

export default AdminDashboard;