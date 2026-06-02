'use client';

// =============================================================================
// TIGEREX v3.0 - COMPLETE ADMIN DASHBOARD
// Enterprise-grade administrative control panel
// =============================================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Wallet, TrendingUp, TrendingDown, Shield, Settings,
  AlertTriangle, CheckCircle, XCircle, Clock, Activity,
  BarChart3, PieChart, LineChart, Search, Filter, Download,
  Plus, Minus, Edit, Trash2, Eye, Lock, Unlock, Mail, Phone,
  CreditCard, DollarSign, Bitcoin, Credit, ArrowUpRight,
  ArrowDownRight, RefreshCw, Bell, ChevronDown, ChevronUp,
  MoreVertical, FileText, Database, Server, Key, Globe,
  Fingerprint, Building2, UserCheck, UserX, Ban, Check,
  X, AlertCircle, Info, ExternalLink, Copy, Send, EyeOff
} from 'lucide-react';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  verifiedUsers: number;
  totalVolume24h: number;
  tradingVolume24h: number;
  totalDeposits24h: number;
  totalWithdrawals24h: number;
  openOrders: number;
  pendingWithdrawals: number;
  pendingKyc: number;
  activeAlerts: number;
}

interface User {
  id: string;
  email: string;
  username: string;
  kycLevel: number;
  kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
  status: 'active' | 'suspended' | 'banned';
  balances: { [asset: string]: number };
  totalDeposits: number;
  totalWithdrawals: number;
  createdAt: string;
  lastLoginAt: string;
  riskLevel: 'low' | 'medium' | 'high';
  twoFactorEnabled: boolean;
  ipAddresses: string[];
  country: string;
  phone?: string;
  notes?: string;
}

interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal' | 'internal' | 'fee';
  asset: string;
  amount: number;
  fee: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  userId: string;
  userEmail: string;
  address?: string;
  txHash?: string;
  createdAt: string;
  processedAt?: string;
  approvedBy?: string;
  rejectedBy?: string;
  rejectReason?: string;
}

interface KYCRequest {
  id: string;
  userId: string;
  userEmail: string;
  level: number;
  status: 'pending' | 'reviewing' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt?: string;
  reviewer?: string;
  rejectionReason?: string;
  documents: {
    type: string;
    url: string;
    verified: boolean;
  }[];
  verificationScore: number;
}

interface Alert {
  id: string;
  type: 'security' | 'risk' | 'compliance' | 'system';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  userId?: string;
  status: 'new' | 'acknowledged' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}

interface Market {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: 'trading' | 'halted' | 'maintenance';
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  makerFee: number;
  takerFee: number;
}

interface SystemHealth {
  component: string;
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  lastCheck: string;
  latency: number;
  errors: number;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const formatNumber = (num: number, decimals = 2): string => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

const formatPercent = (num: number): string => {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const formatDate = (date: string): string => {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const abbreviateNumber = (num: number): string => {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

// =============================================================================
// API SERVICE
// =============================================================================

class AdminApiService {
  private baseUrl = '/api/admin';

  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
      },
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  }

  async post<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  }

  async put<T>(endpoint: string, data: any): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  }

  async delete<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
      },
    });
    if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
    return response.json();
  }
}

const adminApi = new AdminApiService();

// =============================================================================
// CUSTOM HOOKS
// =============================================================================

function useAdminApi<T>(
  endpoint: string,
  options: { autoRefresh?: boolean; refreshInterval?: number } = {}
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await adminApi.get<T>(endpoint);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    fetchData();
    if (options.autoRefresh) {
      const interval = setInterval(fetchData, options.refreshInterval || 30000);
      return () => clearInterval(interval);
    }
  }, [fetchData, options.autoRefresh, options.refreshInterval]);

  return { data, loading, error, refetch: fetchData };
}

// =============================================================================
// COMPONENTS
// =============================================================================

// Stat Card Component
const StatCard: React.FC<{
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  color?: string;
}> = ({ title, value, change, icon, color = 'blue' }) => {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-500',
    green: 'bg-green-500/10 text-green-500',
    red: 'bg-red-500/10 text-red-500',
    orange: 'bg-orange-500/10 text-orange-500',
    purple: 'bg-purple-500/10 text-purple-500',
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
        {change !== undefined && (
          <div className={`flex items-center text-sm ${change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {change >= 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
            {formatPercent(change)}
          </div>
        )}
      </div>
      <h3 className="text-gray-500 dark:text-gray-400 text-sm mb-1">{title}</h3>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
    </div>
  );
};

// Status Badge Component
const StatusBadge: React.FC<{
  status: string;
  size?: 'sm' | 'md';
}> = ({ status, size = 'sm' }) => {
  const statusClasses: Record<string, string> = {
    active: 'bg-green-500/10 text-green-500',
    verified: 'bg-green-500/10 text-green-500',
    completed: 'bg-green-500/10 text-green-500',
    approved: 'bg-green-500/10 text-green-500',
    healthy: 'bg-green-500/10 text-green-500',
    trading: 'bg-green-500/10 text-green-500',
    
    pending: 'bg-yellow-500/10 text-yellow-500',
    processing: 'bg-yellow-500/10 text-yellow-500',
    reviewing: 'bg-yellow-500/10 text-yellow-500',
    degraded: 'bg-yellow-500/10 text-yellow-500',
    new: 'bg-yellow-500/10 text-yellow-500',
    
    suspended: 'bg-red-500/10 text-red-500',
    rejected: 'bg-red-500/10 text-red-500',
    failed: 'bg-red-500/10 text-red-500',
    banned: 'bg-red-500/10 text-red-500',
    cancelled: 'bg-red-500/10 text-red-500',
    down: 'bg-red-500/10 text-red-500',
    critical: 'bg-red-500/10 text-red-500',
    
    halted: 'bg-gray-500/10 text-gray-500',
    maintenance: 'bg-gray-500/10 text-gray-500',
    none: 'bg-gray-500/10 text-gray-500',
  };

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClasses[status] || 'bg-gray-500/10 text-gray-500'} ${sizeClasses}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

// User Row Component
const UserRow: React.FC<{
  user: User;
  onView: (user: User) => void;
  onEdit: (user: User) => void;
  onSuspend: (user: User) => void;
  onBan: (user: User) => void;
}> = ({ user, onView, onEdit, onSuspend, onBan }) => {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <td className="py-4 px-4">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center text-white font-bold">
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div className="ml-3">
            <p className="font-medium text-gray-900 dark:text-white">{user.username}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="py-4 px-4">
        <StatusBadge status={user.kycStatus} />
        <p className="text-xs text-gray-500 mt-1">Level {user.kycLevel}</p>
      </td>
      <td className="py-4 px-4">
        <StatusBadge status={user.status} />
        {user.riskLevel !== 'low' && (
          <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
            user.riskLevel === 'high' ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-500'
          }`}>
            {user.riskLevel.toUpperCase()} RISK
          </span>
        )}
      </td>
      <td className="py-4 px-4">
        <p className="text-gray-900 dark:text-white font-medium">
          {formatCurrency(user.totalDeposits)}
        </p>
        <p className="text-sm text-gray-500">
          Withdrawals: {formatCurrency(user.totalWithdrawals)}
        </p>
      </td>
      <td className="py-4 px-4 text-gray-500 text-sm">
        {formatDate(user.createdAt)}
      </td>
      <td className="py-4 px-4 text-gray-500 text-sm">
        {formatDate(user.lastLoginAt)}
      </td>
      <td className="py-4 px-4">
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <MoreVertical className="w-5 h-5 text-gray-400" />
          </button>
          {showMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800 z-10">
              <button
                onClick={() => { onView(user); setShowMenu(false); }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center"
              >
                <Eye className="w-4 h-4 mr-2" /> View Details
              </button>
              <button
                onClick={() => { onEdit(user); setShowMenu(false); }}
                className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center"
              >
                <Edit className="w-4 h-4 mr-2" /> Edit User
              </button>
              {user.status === 'active' && (
                <button
                  onClick={() => { onSuspend(user); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm text-yellow-600 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center"
                >
                  <Lock className="w-4 h-4 mr-2" /> Suspend User
                </button>
              )}
              <button
                onClick={() => { onBan(user); setShowMenu(false); }}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center"
              >
                <Ban className="w-4 h-4 mr-2" /> Ban User
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
};

// Transaction Row Component
const TransactionRow: React.FC<{
  transaction: Transaction;
  onApprove?: (tx: Transaction) => void;
  onReject?: (tx: Transaction) => void;
}> = ({ transaction, onApprove, onReject }) => {
  const typeIcons: Record<string, React.ReactNode> = {
    deposit: <ArrowDownRight className="w-4 h-4 text-green-500" />,
    withdrawal: <ArrowUpRight className="w-4 h-4 text-red-500" />,
    internal: <ArrowUpRight className="w-4 h-4 text-blue-500" />,
    fee: <DollarSign className="w-4 h-4 text-gray-500" />,
  };

  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <td className="py-4 px-4">
        <div className="flex items-center">
          {typeIcons[transaction.type]}
          <div className="ml-2">
            <p className="font-medium text-gray-900 dark:text-white">{transaction.type}</p>
            <p className="text-xs text-gray-500">{transaction.id}</p>
          </div>
        </div>
      </td>
      <td className="py-4 px-4">
        <p className="text-gray-900 dark:text-white">{transaction.asset}</p>
        <p className="text-sm font-medium">{formatNumber(transaction.amount)}</p>
      </td>
      <td className="py-4 px-4">
        <StatusBadge status={transaction.status} />
      </td>
      <td className="py-4 px-4">
        <p className="text-sm text-gray-900 dark:text-white">{transaction.userEmail}</p>
        <p className="text-xs text-gray-500">{transaction.userId}</p>
      </td>
      <td className="py-4 px-4 text-sm text-gray-500">
        {formatDate(transaction.createdAt)}
      </td>
      <td className="py-4 px-4">
        {transaction.status === 'pending' && onApprove && onReject && (
          <div className="flex gap-2">
            <button
              onClick={() => onApprove(transaction)}
              className="p-2 bg-green-500/10 text-green-500 rounded-lg hover:bg-green-500/20"
              title="Approve"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => onReject(transaction)}
              className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20"
              title="Reject"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {transaction.txHash && (
          <button className="text-blue-500 hover:text-blue-600 text-sm">
            View Tx
          </button>
        )}
      </td>
    </tr>
  );
};

// KYC Card Component
const KYCCard: React.FC<{
  request: KYCRequest;
  onApprove: (request: KYCRequest) => void;
  onReject: (request: KYCRequest) => void;
  onView: (request: KYCRequest) => void;
}> = ({ request, onApprove, onReject, onView }) => {
  const scoreColor = request.verificationScore >= 80 ? 'text-green-500' :
                     request.verificationScore >= 50 ? 'text-yellow-500' : 'text-red-500';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{request.userEmail}</p>
          <p className="text-sm text-gray-500">User: {request.userId}</p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-500">Level</p>
          <p className="font-medium">{request.level}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Score</p>
          <p className={`font-medium ${scoreColor}`}>{request.verificationScore}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Documents</p>
          <p className="font-medium">{request.documents.length}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onView(request)}
          className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-sm"
        >
          View Documents
        </button>
        <button
          onClick={() => onApprove(request)}
          className="flex-1 px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm"
        >
          Approve
        </button>
        <button
          onClick={() => onReject(request)}
          className="px-3 py-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Submitted: {formatDate(request.submittedAt)}
      </p>
    </div>
  );
};

// Alert Card Component
const AlertCard: React.FC<{
  alert: Alert;
  onAcknowledge: (alert: Alert) => void;
  onResolve: (alert: Alert) => void;
}> = ({ alert, onAcknowledge, onResolve }) => {
  const severityColors: Record<string, string> = {
    low: 'border-l-yellow-500',
    medium: 'border-l-orange-500',
    high: 'border-l-red-500',
    critical: 'border-l-red-700',
  };

  const severityIcons: Record<string, React.ReactNode> = {
    security: <Shield className="w-5 h-5" />,
    risk: <AlertTriangle className="w-5 h-5" />,
    compliance: <FileText className="w-5 h-5" />,
    system: <Server className="w-5 h-5" />,
  };

  return (
    <div className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 border-l-4 ${severityColors[alert.severity]} p-4`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center">
          <div className={`p-2 rounded-lg ${
            alert.severity === 'critical' ? 'bg-red-500/10 text-red-500' :
            alert.severity === 'high' ? 'bg-red-500/10 text-red-500' :
            alert.severity === 'medium' ? 'bg-orange-500/10 text-orange-500' :
            'bg-yellow-500/10 text-yellow-500'
          }`}>
            {severityIcons[alert.type]}
          </div>
          <div className="ml-3">
            <p className="font-medium text-gray-900 dark:text-white">{alert.title}</p>
            <p className="text-xs text-gray-500">{alert.type.toUpperCase()} • {alert.severity.toUpperCase()}</p>
          </div>
        </div>
        <StatusBadge status={alert.status} />
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{alert.description}</p>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {formatDate(alert.createdAt)}
          {alert.userId && ` • User: ${alert.userId}`}
        </p>
        <div className="flex gap-2">
          {alert.status === 'new' && (
            <button
              onClick={() => onAcknowledge(alert)}
              className="px-3 py-1 bg-yellow-500/10 text-yellow-500 rounded-lg hover:bg-yellow-500/20 text-sm"
            >
              Acknowledge
            </button>
          )}
          {alert.status === 'acknowledged' && (
            <button
              onClick={() => onResolve(alert)}
              className="px-3 py-1 bg-green-500/10 text-green-500 rounded-lg hover:bg-green-500/20 text-sm"
            >
              Resolve
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// System Health Component
const SystemHealthCard: React.FC<{
  system: SystemHealth;
}> = ({ system }) => {
  const statusColor = system.status === 'healthy' ? 'text-green-500' :
                      system.status === 'degraded' ? 'text-yellow-500' : 'text-red-500';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <Server className={`w-5 h-5 ${statusColor}`} />
          <p className="ml-2 font-medium text-gray-900 dark:text-white">{system.component}</p>
        </div>
        <StatusBadge status={system.status} />
      </div>

      <div className="grid grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-gray-500">Uptime</p>
          <p className="font-medium">{system.uptime.toFixed(2)}%</p>
        </div>
        <div>
          <p className="text-gray-500">Latency</p>
          <p className="font-medium">{system.latency}ms</p>
        </div>
        <div>
          <p className="text-gray-500">Errors</p>
          <p className={`font-medium ${system.errors > 0 ? 'text-red-500' : ''}`}>
            {system.errors}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Last Check</p>
          <p className="text-xs">{formatDate(system.lastCheck)}</p>
        </div>
      </div>
    </div>
  );
};

// Search and Filter Bar Component
const SearchFilterBar: React.FC<{
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ searchPlaceholder = 'Search...', onSearch, filters, actions }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    onSearch?.(value);
  };

  return (
    <div className="flex items-center justify-between mb-6 gap-4">
      <div className="flex-1 flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none"
          />
        </div>
        {filters}
      </div>
      {actions}
    </div>
  );
};

// Pagination Component
const Pagination: React.FC<{
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}> = ({ currentPage, totalPages, onPageChange }) => {
  const pages = Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1);

  return (
    <div className="flex items-center justify-between mt-6">
      <p className="text-sm text-gray-500">
        Page {currentPage} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg disabled:opacity-50"
        >
          Previous
        </button>
        {pages.map((page) => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`px-3 py-1 rounded-lg ${
              currentPage === page
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {page}
          </button>
        ))}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
};

// Modal Component
const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}> = ({ isOpen, onClose, title, children, size = 'md' }) => {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />
        <div className={`relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full ${sizeClasses[size]} max-h-[90vh] overflow-y-auto`}>
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
};

// Chart Component (Simple Bar Chart)
const SimpleBarChart: React.FC<{
  data: { label: string; value: number }[];
  color?: string;
}> = ({ data, color = '#f97316' }) => {
  const maxValue = Math.max(...data.map(d => d.value));

  return (
    <div className="flex items-end justify-between h-40 gap-2">
      {data.map((item, index) => (
        <div key={index} className="flex-1 flex flex-col items-center">
          <div
            className="w-full rounded-t"
            style={{
              height: `${(item.value / maxValue) * 100}%`,
              backgroundColor: color,
              minHeight: '4px',
            }}
          />
          <p className="text-xs text-gray-500 mt-2 truncate w-full text-center">{item.label}</p>
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// MAIN ADMIN DASHBOARD
// =============================================================================

export function AdminDashboard() {
  // State
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Mock data
  const stats: AdminStats = {
    totalUsers: 125847,
    activeUsers: 45231,
    verifiedUsers: 89456,
    totalVolume24h: 1234567890,
    tradingVolume24h: 987654321,
    totalDeposits24h: 34567890,
    totalWithdrawals24h: 12345678,
    openOrders: 15432,
    pendingWithdrawals: 234,
    pendingKyc: 56,
    activeAlerts: 12,
  };

  const mockUsers: User[] = [
    {
      id: 'user1',
      email: 'john.doe@example.com',
      username: 'JohnDoe',
      kycLevel: 3,
      kycStatus: 'verified',
      status: 'active',
      balances: { BTC: 1.5, ETH: 10.0, USDT: 50000 },
      totalDeposits: 100000,
      totalWithdrawals: 50000,
      createdAt: '2024-01-15T10:30:00Z',
      lastLoginAt: '2026-06-01T14:20:00Z',
      riskLevel: 'low',
      twoFactorEnabled: true,
      ipAddresses: ['192.168.1.1', '10.0.0.1'],
      country: 'United States',
    },
    {
      id: 'user2',
      email: 'jane.smith@example.com',
      username: 'JaneSmith',
      kycLevel: 2,
      kycStatus: 'verified',
      status: 'active',
      balances: { BTC: 0.5, ETH: 5.0 },
      totalDeposits: 25000,
      totalWithdrawals: 10000,
      createdAt: '2024-03-20T08:15:00Z',
      lastLoginAt: '2026-06-01T09:45:00Z',
      riskLevel: 'medium',
      twoFactorEnabled: false,
      ipAddresses: ['172.16.0.1'],
      country: 'United Kingdom',
    },
    {
      id: 'user3',
      email: 'bob.wilson@example.com',
      username: 'BobWilson',
      kycLevel: 1,
      kycStatus: 'pending',
      status: 'active',
      balances: { USDT: 1000 },
      totalDeposits: 1000,
      totalWithdrawals: 0,
      createdAt: '2026-05-28T16:00:00Z',
      lastLoginAt: '2026-06-01T11:30:00Z',
      riskLevel: 'high',
      twoFactorEnabled: false,
      ipAddresses: ['192.168.2.1', '192.168.2.2', '192.168.2.3'],
      country: 'Singapore',
    },
  ];

  const mockTransactions: Transaction[] = [
    {
      id: 'tx1',
      type: 'deposit',
      asset: 'BTC',
      amount: 1.5,
      fee: 0.00015,
      status: 'completed',
      userId: 'user1',
      userEmail: 'john.doe@example.com',
      txHash: '0x1234567890abcdef',
      createdAt: '2026-06-01T10:30:00Z',
      processedAt: '2026-06-01T10:31:00Z',
    },
    {
      id: 'tx2',
      type: 'withdrawal',
      asset: 'USDT',
      amount: 10000,
      fee: 10,
      status: 'pending',
      userId: 'user2',
      userEmail: 'jane.smith@example.com',
      address: '0xabcdef1234567890',
      createdAt: '2026-06-01T12:00:00Z',
    },
  ];

  const mockKycRequests: KYCRequest[] = [
    {
      id: 'kyc1',
      userId: 'user3',
      userEmail: 'bob.wilson@example.com',
      level: 2,
      status: 'pending',
      submittedAt: '2026-06-01T09:00:00Z',
      documents: [
        { type: 'passport', url: '/docs/passport.pdf', verified: false },
        { type: 'proof_of_address', url: '/docs/address.pdf', verified: false },
      ],
      verificationScore: 85,
    },
  ];

  const mockAlerts: Alert[] = [
    {
      id: 'alert1',
      type: 'security',
      severity: 'high',
      title: 'Multiple Failed Login Attempts',
      description: 'User user3 has 5 failed login attempts in the last hour',
      userId: 'user3',
      status: 'new',
      createdAt: '2026-06-01T13:00:00Z',
    },
    {
      id: 'alert2',
      type: 'risk',
      severity: 'medium',
      title: 'Large Withdrawal Request',
      description: 'Withdrawal of $50,000 USDT pending approval',
      userId: 'user2',
      status: 'acknowledged',
      createdAt: '2026-06-01T11:30:00Z',
    },
  ];

  const mockMarkets: Market[] = [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'trading', price: 67432.50, change24h: 2.5, volume24h: 1234567, high24h: 68000, low24h: 66000, makerFee: 0.001, takerFee: 0.001 },
    { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', status: 'trading', price: 3456.78, change24h: -1.2, volume24h: 876543, high24h: 3500, low24h: 3400, makerFee: 0.001, takerFee: 0.001 },
    { symbol: 'BNBUSDT', baseAsset: 'BNB', quoteAsset: 'USDT', status: 'trading', price: 598.45, change24h: 0.8, volume24h: 234567, high24h: 600, low24h: 590, makerFee: 0.001, takerFee: 0.001 },
  ];

  const mockSystemHealth: SystemHealth[] = [
    { component: 'Matching Engine', status: 'healthy', uptime: 99.99, lastCheck: '2026-06-02T10:00:00Z', latency: 5, errors: 0 },
    { component: 'Database Primary', status: 'healthy', uptime: 99.95, lastCheck: '2026-06-02T10:00:00Z', latency: 2, errors: 0 },
    { component: 'Database Replica', status: 'healthy', uptime: 99.98, lastCheck: '2026-06-02T10:00:00Z', latency: 3, errors: 0 },
    { component: 'Redis Cache', status: 'healthy', uptime: 99.99, lastCheck: '2026-06-02T10:00:00Z', latency: 1, errors: 0 },
    { component: 'WebSocket Server', status: 'healthy', uptime: 99.90, lastCheck: '2026-06-02T10:00:00Z', latency: 8, errors: 2 },
    { component: 'Order Processing', status: 'healthy', uptime: 99.95, lastCheck: '2026-06-02T10:00:00Z', latency: 10, errors: 0 },
    { component: 'Withdrawal Service', status: 'degraded', uptime: 98.50, lastCheck: '2026-06-02T10:00:00Z', latency: 150, errors: 15 },
    { component: 'KYC Service', status: 'healthy', uptime: 99.80, lastCheck: '2026-06-02T10:00:00Z', latency: 25, errors: 1 },
  ];

  // Tab navigation
  const tabs = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'users', label: 'Users', icon: <Users className="w-5 h-5" /> },
    { id: 'transactions', label: 'Transactions', icon: <CreditCard className="w-5 h-5" /> },
    { id: 'kyc', label: 'KYC', icon: <UserCheck className="w-5 h-5" /> },
    { id: 'alerts', label: 'Alerts', icon: <AlertTriangle className="w-5 h-5" /> },
    { id: 'markets', label: 'Markets', icon: <TrendingUp className="w-5 h-5" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-5 h-5" /> },
    { id: 'system', label: 'System', icon: <Server className="w-5 h-5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-all duration-300 flex flex-col`}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-center border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl">T</span>
            </div>
            {sidebarOpen && <span className="ml-3 font-bold text-xl text-gray-900 dark:text-white">TigerEx</span>}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center p-3 rounded-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-orange-500/10 text-orange-500'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {tab.icon}
              {sidebarOpen && <span className="ml-3">{tab.label}</span>}
            </button>
          ))}
        </nav>

        {/* Toggle Button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-4 border-t border-gray-200 dark:border-gray-800 text-gray-400 hover:text-gray-600"
        >
          {sidebarOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6">
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white capitalize">{activeTab}</h1>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 text-gray-400 hover:text-gray-600 relative">
              <Bell className="w-5 h-5" />
              {stats.activeAlerts > 0 && (
                <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full"></span>
              )}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
              <div className="text-sm">
                <p className="font-medium text-gray-900 dark:text-white">Admin</p>
                <p className="text-gray-500 text-xs">Super Admin</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-6 overflow-y-auto">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Total Users"
                  value={stats.totalUsers}
                  icon={<Users className="w-6 h-6" />}
                  color="blue"
                />
                <StatCard
                  title="Active Users (24h)"
                  value={stats.activeUsers}
                  change={5.2}
                  icon={<Activity className="w-6 h-6" />}
                  color="green"
                />
                <StatCard
                  title="Trading Volume (24h)"
                  value={formatCurrency(stats.tradingVolume24h)}
                  change={3.8}
                  icon={<TrendingUp className="w-6 h-6" />}
                  color="orange"
                />
                <StatCard
                  title="Total Deposits (24h)"
                  value={formatCurrency(stats.totalDeposits24h)}
                  change={12.5}
                  icon={<ArrowDownRight className="w-6 h-6" />}
                  color="green"
                />
              </div>

              {/* Secondary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Pending Withdrawals"
                  value={stats.pendingWithdrawals}
                  icon={<Clock className="w-6 h-6" />}
                  color="yellow"
                />
                <StatCard
                  title="Pending KYC"
                  value={stats.pendingKyc}
                  icon={<UserCheck className="w-6 h-6" />}
                  color="purple"
                />
                <StatCard
                  title="Open Orders"
                  value={stats.openOrders}
                  icon={<FileText className="w-6 h-6" />}
                  color="blue"
                />
                <StatCard
                  title="Active Alerts"
                  value={stats.activeAlerts}
                  icon={<AlertTriangle className="w-6 h-6" />}
                  color="red"
                />
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Volume Chart */}
                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Trading Volume (7 Days)</h3>
                  <SimpleBarChart
                    data={[
                      { label: 'Mon', value: 120 },
                      { label: 'Tue', value: 150 },
                      { label: 'Wed', value: 180 },
                      { label: 'Thu', value: 140 },
                      { label: 'Fri', value: 200 },
                      { label: 'Sat', value: 160 },
                      { label: 'Sun', value: 190 },
                    ]}
                    color="#f97316"
                  />
                </div>

                {/* New Users Chart */}
                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">New Users (7 Days)</h3>
                  <SimpleBarChart
                    data={[
                      { label: 'Mon', value: 450 },
                      { label: 'Tue', value: 520 },
                      { label: 'Wed', value: 480 },
                      { label: 'Thu', value: 610 },
                      { label: 'Fri', value: 550 },
                      { label: 'Sat', value: 420 },
                      { label: 'Sun', value: 380 },
                    ]}
                    color="#22c55e"
                  />
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Recent Transactions</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-sm text-gray-500 border-b border-gray-200 dark:border-gray-800">
                        <th className="pb-3">Type</th>
                        <th className="pb-3">Asset</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">User</th>
                        <th className="pb-3">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mockTransactions.map((tx) => (
                        <tr key={tx.id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-3 capitalize">{tx.type}</td>
                          <td className="py-3">{tx.asset}</td>
                          <td className="py-3"><StatusBadge status={tx.status} /></td>
                          <td className="py-3">{tx.userEmail}</td>
                          <td className="py-3 text-gray-500 text-sm">{formatDate(tx.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
            <div className="space-y-6">
              <SearchFilterBar
                searchPlaceholder="Search users by email or username..."
                filters={
                  <select className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm">
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="banned">Banned</option>
                  </select>
                }
                actions={
                  <button className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center">
                    <Plus className="w-4 h-4 mr-2" /> Export
                  </button>
                }
              />
              
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-500 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                      <th className="py-4 px-4 font-medium">User</th>
                      <th className="py-4 px-4 font-medium">KYC</th>
                      <th className="py-4 px-4 font-medium">Status</th>
                      <th className="py-4 px-4 font-medium">Volume</th>
                      <th className="py-4 px-4 font-medium">Created</th>
                      <th className="py-4 px-4 font-medium">Last Login</th>
                      <th className="py-4 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockUsers.map((user) => (
                      <UserRow
                        key={user.id}
                        user={user}
                        onView={(u) => console.log('View', u)}
                        onEdit={(u) => console.log('Edit', u)}
                        onSuspend={(u) => console.log('Suspend', u)}
                        onBan={(u) => console.log('Ban', u)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination currentPage={1} totalPages={10} onPageChange={(p) => console.log('Page', p)} />
            </div>
          )}

          {/* Transactions Tab */}
          {activeTab === 'transactions' && (
            <div className="space-y-6">
              <SearchFilterBar
                searchPlaceholder="Search by transaction ID, user, or address..."
                filters={
                  <>
                    <select className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm mr-2">
                      <option value="all">All Types</option>
                      <option value="deposit">Deposit</option>
                      <option value="withdrawal">Withdrawal</option>
                      <option value="internal">Internal</option>
                    </select>
                    <select className="px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm mr-2">
                      <option value="all">All Status</option>
                      <option value="pending">Pending</option>
                      <option value="processing">Processing</option>
                      <option value="completed">Completed</option>
                      <option value="failed">Failed</option>
                    </select>
                  </>
                }
                actions={
                  <button className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center">
                    <Download className="w-4 h-4 mr-2" /> Export CSV
                  </button>
                }
              />
              
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-500 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                      <th className="py-4 px-4 font-medium">Type</th>
                      <th className="py-4 px-4 font-medium">Amount</th>
                      <th className="py-4 px-4 font-medium">Status</th>
                      <th className="py-4 px-4 font-medium">User</th>
                      <th className="py-4 px-4 font-medium">Date</th>
                      <th className="py-4 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockTransactions.map((tx) => (
                      <TransactionRow
                        key={tx.id}
                        transaction={tx}
                        onApprove={(t) => console.log('Approve', t)}
                        onReject={(t) => console.log('Reject', t)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination currentPage={1} totalPages={20} onPageChange={(p) => console.log('Page', p)} />
            </div>
          )}

          {/* KYC Tab */}
          {activeTab === 'kyc' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Pending KYC Requests ({mockKycRequests.length})</h2>
                <div className="flex gap-2">
                  <button className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg">All</button>
                  <button className="px-4 py-2 bg-orange-500 text-white rounded-lg">Pending</button>
                  <button className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg">Reviewed</button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mockKycRequests.map((request) => (
                  <KYCCard
                    key={request.id}
                    request={request}
                    onApprove={(r) => console.log('Approve', r)}
                    onReject={(r) => console.log('Reject', r)}
                    onView={(r) => console.log('View', r)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Alerts Tab */}
          {activeTab === 'alerts' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Active Alerts ({mockAlerts.filter(a => a.status !== 'resolved').length})
                </h2>
                <div className="flex gap-2">
                  <button className="px-4 py-2 bg-red-500/10 text-red-500 rounded-lg">All</button>
                  <button className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg">Security</button>
                  <button className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg">Risk</button>
                  <button className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg">System</button>
                </div>
              </div>

              <div className="space-y-4">
                {mockAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={(a) => console.log('Acknowledge', a)}
                    onResolve={(a) => console.log('Resolve', a)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Markets Tab */}
          {activeTab === 'markets' && (
            <div className="space-y-6">
              <SearchFilterBar
                searchPlaceholder="Search markets..."
                actions={
                  <button className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center">
                    <Plus className="w-4 h-4 mr-2" /> Add Market
                  </button>
                }
              />

              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-gray-500 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                      <th className="py-4 px-4 font-medium">Market</th>
                      <th className="py-4 px-4 font-medium">Price</th>
                      <th className="py-4 px-4 font-medium">24h Change</th>
                      <th className="py-4 px-4 font-medium">24h Volume</th>
                      <th className="py-4 px-4 font-medium">Status</th>
                      <th className="py-4 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mockMarkets.map((market) => (
                      <tr key={market.symbol} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-4 px-4">
                          <p className="font-medium text-gray-900 dark:text-white">{market.symbol}</p>
                        </td>
                        <td className="py-4 px-4">
                          ${formatNumber(market.price)}
                        </td>
                        <td className={`py-4 px-4 ${market.change24h >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {formatPercent(market.change24h)}
                        </td>
                        <td className="py-4 px-4">
                          ${abbreviateNumber(market.volume24h)}
                        </td>
                        <td className="py-4 px-4">
                          <StatusBadge status={market.status} />
                        </td>
                        <td className="py-4 px-4">
                          <button className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-700">
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Security Settings</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">Two-Factor Authentication</p>
                        <p className="text-sm text-gray-500">Require 2FA for all withdrawals</p>
                      </div>
                      <button className="w-12 h-6 bg-green-500 rounded-full relative">
                        <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">Withdrawal Whitelist</p>
                        <p className="text-sm text-gray-500">Only allow withdrawals to whitelisted addresses</p>
                      </div>
                      <button className="w-12 h-6 bg-green-500 rounded-full relative">
                        <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">Daily Withdrawal Limit</p>
                        <p className="text-sm text-gray-500">$100,000 per user per day</p>
                      </div>
                      <button className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm">Edit</button>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">API Keys</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">Production API</p>
                        <p className="text-xs text-gray-500">Last used: 2 hours ago</p>
                      </div>
                      <div className="flex gap-2">
                        <button className="p-2 text-gray-400 hover:text-gray-600">
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button className="p-2 text-red-500 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <button className="w-full px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center justify-center">
                      <Plus className="w-4 h-4 mr-2" /> Create New API Key
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* System Tab */}
          {activeTab === 'system' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">System Health</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {mockSystemHealth.map((system) => (
                  <SystemHealthCard key={system.component} system={system} />
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Database Status</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Primary DB</span>
                      <span className="flex items-center text-green-500">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                        Connected
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Replica DB</span>
                      <span className="flex items-center text-green-500">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                        Connected (Replication: 50ms)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Cache (Redis)</span>
                      <span className="flex items-center text-green-500">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                        Connected
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Service Status</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Matching Engine</span>
                      <span className="text-green-500">Running</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Order Processor</span>
                      <span className="text-green-500">Running</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Withdrawal Service</span>
                      <span className="text-yellow-500">Degraded (15 errors)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">General Settings</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Platform Name</label>
                    <input type="text" defaultValue="TigerEx" className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Support Email</label>
                    <input type="email" defaultValue="support@tigerex.com" className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Maintenance Mode</label>
                    <div className="flex items-center">
                      <button className="w-12 h-6 bg-gray-300 rounded-full relative">
                        <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                      </button>
                      <span className="ml-3 text-sm text-gray-500">System is online</span>
                    </div>
                  </div>
                </div>
                <button className="mt-6 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
                  Save Changes
                </button>
              </div>

              <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Fee Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Maker Fee (%)</label>
                    <input type="number" defaultValue="0.1" step="0.01" className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Taker Fee (%)</label>
                    <input type="number" defaultValue="0.1" step="0.01" className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Withdrawal Fee (BTC)</label>
                    <input type="number" defaultValue="0.0005" step="0.0001" className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Withdrawal Fee (ETH)</label>
                    <input type="number" defaultValue="0.005" step="0.001" className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg" />
                  </div>
                </div>
                <button className="mt-6 px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
                  Update Fees
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default AdminDashboard;