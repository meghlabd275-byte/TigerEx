// =============================================================================
// TIGGEREX v3.0 - ADMIN DASHBOARD
// Complete admin panel with user management, compliance, analytics, and operations
// =============================================================================

import React, { useState, useEffect, useMemo } from 'react';
import {
  Users, DollarSign, TrendingUp, AlertTriangle, Shield, Settings, 
  BarChart3, PieChart, Activity, Clock, Bell, Search, Filter,
  ChevronDown, ChevronUp, Eye, Edit, Trash2, Check, X,
  Download, Upload, RefreshCw, Plus, Minus, Lock, Unlock,
  CreditCard, ArrowUpRight, ArrowDownRight, Wallet, Globe,
  Server, Database, HardDrive, Cpu, Wifi, WifiOff,
  AlertCircle, Info, CheckCircle, XCircle, Warning, HelpCircle
} from 'lucide-react';

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

interface AdminUser {
  id: string;
  email: string;
  username: string;
  kycLevel: string;
  status: 'active' | 'suspended' | 'restricted';
  riskLevel: string;
  balances: { currency: string; total: string }[];
  createdAt: string;
  lastLogin: string;
  totalDeposits: string;
  totalWithdrawals: string;
  totalTrades: number;
  verificationStatus: string;
}

interface ComplianceAlert {
  id: string;
  userId: string;
  username: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'reviewing' | 'pending' | 'resolved' | 'dismissed';
  description: string;
  transactionAmount?: string;
  createdAt: string;
  assignedTo?: string;
}

interface Order {
  id: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  price: string;
  quantity: string;
  filled: string;
  status: string;
  createdAt: string;
}

interface WithdrawalRequest {
  id: string;
  userId: string;
  username: string;
  currency: string;
  amount: string;
  address: string;
  status: 'pending' | 'approved' | 'processing' | 'completed' | 'rejected';
  riskScore: number;
  createdAt: string;
}

interface SystemMetric {
  name: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'stable';
}

interface AuditLog {
  id: string;
  action: string;
  userId: string;
  targetType: string;
  targetId: string;
  ip: string;
  userAgent: string;
  details: string;
  createdAt: string;
}

// =============================================================================
// DASHBOARD COMPONENTS
// =============================================================================

// Stats Cards
const StatsCard: React.FC<{
  title: string;
  value: string;
  change: string;
  changeType: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
}> = ({ title, value, change, changeType, icon }) => (
  <div className="bg-white dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-orange-100 dark:bg-orange-900/20 rounded-lg">
        {icon}
      </div>
      <span className={`text-sm font-medium ${
        changeType === 'positive' ? 'text-green-500' : 
        changeType === 'negative' ? 'text-red-500' : 'text-gray-500'
      }`}>
        {change}
      </span>
    </div>
    <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">{value}</div>
    <div className="text-sm text-gray-500">{title}</div>
  </div>
);

// Platform Overview Stats
const PlatformOverview: React.FC = () => {
  const stats = [
    {
      title: 'Total Users',
      value: '1,234,567',
      change: '+12.5%',
      changeType: 'positive' as const,
      icon: <Users className="w-5 h-5 text-orange-500" />
    },
    {
      title: '24h Trading Volume',
      value: '$5.67B',
      change: '+8.2%',
      changeType: 'positive' as const,
      icon: <TrendingUp className="w-5 h-5 text-orange-500" />
    },
    {
      title: 'Active Traders',
      value: '45,678',
      change: '+5.3%',
      changeType: 'positive' as const,
      icon: <Activity className="w-5 h-5 text-orange-500" />
    },
    {
      title: 'Revenue (24h)',
      value: '$12.5M',
      change: '+15.8%',
      changeType: 'positive' as const,
      icon: <DollarSign className="w-5 h-5 text-orange-500" />
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <StatsCard key={i} {...stat} />
      ))}
    </div>
  );
};

// System Health Dashboard
const SystemHealth: React.FC = () => {
  const [metrics, setMetrics] = useState<SystemMetric[]>([
    { name: 'API Latency', value: '45ms', change: '-12%', trend: 'down' as const },
    { name: 'Database Connections', value: '1,234', change: '+5%', trend: 'up' as const },
    { name: 'Memory Usage', value: '67%', change: '+2%', trend: 'up' as const },
    { name: 'CPU Usage', value: '34%', change: '-8%', trend: 'down' as const },
    { name: 'Network In', value: '2.5 Gbps', change: '+15%', trend: 'up' as const },
    { name: 'Network Out', value: '1.8 Gbps', change: '+22%', trend: 'up' as const },
  ]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">System Health</h3>
        </div>
        <span className="flex items-center gap-1 text-sm text-green-500">
          <CheckCircle className="w-4 h-4" />
          All Systems Operational
        </span>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
        {metrics.map((metric, i) => (
          <div key={i} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div>
              <div className="text-xs text-gray-500">{metric.name}</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">{metric.value}</div>
            </div>
            <span className={`text-xs ${
              metric.trend === 'down' ? 'text-green-500' : 'text-orange-500'
            }`}>
              {metric.change}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Recent Alerts
const RecentAlerts: React.FC<{ alerts: ComplianceAlert[] }> = ({ alerts }) => {
  const severityColors = {
    low: 'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    medium: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400',
    high: 'bg-orange-100 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400',
    critical: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Recent Alerts</h3>
        </div>
        <button className="text-sm text-orange-500 hover:underline">View All</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {alerts.slice(0, 5).map((alert, i) => (
          <div key={i} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${severityColors[alert.severity]}`}>
                    {alert.severity.toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-500">{alert.type}</span>
                </div>
                <div className="text-sm text-gray-900 dark:text-white mb-1">
                  User: {alert.username} ({alert.userId})
                </div>
                <div className="text-sm text-gray-500">{alert.description}</div>
                {alert.transactionAmount && (
                  <div className="text-xs text-gray-400 mt-1">
                    Amount: {alert.transactionAmount}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <Eye className="w-4 h-4 text-gray-500" />
                </button>
                <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                  <Check className="w-4 h-4 text-green-500" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Pending Approvals
const PendingApprovals: React.FC<{ items: WithdrawalRequest[] }> = ({ items }) => {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Pending Withdrawals</h3>
        </div>
        <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/20 text-orange-600 rounded-full text-xs font-medium">
          {items.length} pending
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Currency</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Risk</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Time</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((item, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 dark:text-white">{item.username}</div>
                  <div className="text-xs text-gray-500">{item.userId}</div>
                </td>
                <td className="px-4 py-3 text-gray-900 dark:text-white">{item.currency}</td>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{item.amount}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    item.riskScore > 70 ? 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' :
                    item.riskScore > 40 ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400' :
                    'bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400'
                  }`}>
                    {item.riskScore}%
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500">{new Date(item.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button className="p-1.5 hover:bg-green-100 dark:hover:bg-green-900/20 rounded text-green-600">
                      <Check className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/20 rounded text-red-600">
                      <X className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500">
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// User Management Table
const UserManagement: React.FC<{ users: AdminUser[] }> = ({ users }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = 
        user.username.toLowerCase().includes(search.toLowerCase()) ||
        user.email.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = filter === 'all' || user.status === filter;
      return matchesSearch && matchesFilter;
    });
  }, [users, search, filter]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">User Management</h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border-0 rounded-lg text-sm"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">User</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">KYC</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Risk</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Volume</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Trades</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Joined</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {filteredUsers.slice(0, 10).map((user, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                      {user.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{user.username}</div>
                      <div className="text-xs text-gray-500">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    user.kycLevel === 'advanced' ? 'bg-green-100 text-green-600 dark:bg-green-900/20' :
                    user.kycLevel === 'intermediate' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/20' :
                    'bg-gray-100 text-gray-600 dark:bg-gray-800'
                  }`}>
                    {user.kycLevel}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    user.riskLevel === 'high' ? 'bg-red-100 text-red-600 dark:bg-red-900/20' :
                    user.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20' :
                    'bg-green-100 text-green-600 dark:bg-green-900/20'
                  }`}>
                    {user.riskLevel}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    user.status === 'active' ? 'bg-green-100 text-green-600 dark:bg-green-900/20' :
                    user.status === 'suspended' ? 'bg-red-100 text-red-600 dark:bg-red-900/20' :
                    'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/20'
                  }`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-900 dark:text-white">
                  ${user.totalDeposits}
                </td>
                <td className="px-4 py-3 text-gray-900 dark:text-white">
                  {user.totalTrades.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500">
                      <Eye className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500">
                      <Edit className="w-4 h-4" />
                    </button>
                    <button className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/20 rounded text-red-500">
                      <Lock className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Audit Log
const AuditLogViewer: React.FC<{ logs: AuditLog[] }> = ({ logs }) => (
  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
    <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-orange-500" />
        <h3 className="font-semibold text-gray-900 dark:text-white">Audit Log</h3>
      </div>
      <div className="flex gap-2">
        <button className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-1">
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>
    </div>
    <div className="divide-y divide-gray-100 dark:divide-gray-800 max-h-96 overflow-y-auto">
      {logs.map((log, i) => (
        <div key={i} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                <Activity className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <div className="font-medium text-gray-900 dark:text-white">{log.action}</div>
                <div className="text-sm text-gray-500">
                  {log.targetType}: {log.targetId}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-500">{log.userId}</div>
              <div className="text-xs text-gray-400">
                {new Date(log.createdAt).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Market Management
const MarketManagement: React.FC = () => {
  const [markets, setMarkets] = useState([
    { symbol: 'BTC/USDT', price: '67,234.56', change: '+2.34%', volume: '1.23B', status: 'active', trading: true },
    { symbol: 'ETH/USDT', price: '3,456.78', change: '+1.56%', volume: '890M', status: 'active', trading: true },
    { symbol: 'BNB/USDT', price: '567.89', change: '-0.45%', volume: '234M', status: 'active', trading: true },
    { symbol: 'SOL/USDT', price: '123.45', change: '+5.67%', volume: '567M', status: 'active', trading: true },
  ]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Market Management</h3>
        </div>
        <button className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm flex items-center gap-1">
          <Plus className="w-4 h-4" />
          Add Market
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Market</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Price</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">24h Change</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">24h Volume</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Trading</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {markets.map((market, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{market.symbol}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-white">${market.price}</td>
                <td className={`px-4 py-3 text-right font-medium ${
                  market.change.startsWith('+') ? 'text-green-500' : 'text-red-500'
                }`}>
                  {market.change}
                </td>
                <td className="px-4 py-3 text-right text-gray-500">${market.volume}</td>
                <td className="px-4 py-3 text-center">
                  <button className={`px-3 py-1 rounded-full text-xs font-medium ${
                    market.trading
                      ? 'bg-green-100 text-green-600 dark:bg-green-900/20'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                  }`}>
                    {market.trading ? 'ON' : 'OFF'}
                  </button>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="px-2 py-0.5 bg-green-100 text-green-600 dark:bg-green-900/20 rounded text-xs">
                    {market.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500">
                    <Settings className="w-4 h-4" />
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

// Fee Management
const FeeManagement: React.FC = () => {
  const [fees] = useState([
    { tier: 'VIP 0', makerFee: '0.10%', takerFee: '0.10%', minVolume: '$0' },
    { tier: 'VIP 1', makerFee: '0.09%', takerFee: '0.10%', minVolume: '$100K' },
    { tier: 'VIP 2', makerFee: '0.08%', takerFee: '0.09%', minVolume: '$1M' },
    { tier: 'VIP 3', makerFee: '0.07%', takerFee: '0.08%', minVolume: '$10M' },
    { tier: 'VIP 4', makerFee: '0.06%', takerFee: '0.07%', minVolume: '$50M' },
    { tier: 'VIP 5', makerFee: '0.05%', takerFee: '0.06%', minVolume: '$100M' },
  ]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-orange-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Fee Tiers</h3>
        </div>
        <button className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm flex items-center gap-1">
          <Edit className="w-4 h-4" />
          Edit Fees
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Tier</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Maker Fee</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Taker Fee</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Min. Volume (30d)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {fees.map((fee, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{fee.tier}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{fee.makerFee}</td>
                <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{fee.takerFee}</td>
                <td className="px-4 py-3 text-right text-gray-500">{fee.minVolume}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// =============================================================================
// MAIN ADMIN DASHBOARD
// =============================================================================

export function AdminDashboard() {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Mock data
  const [alerts] = useState<ComplianceAlert[]>([
    { id: '1', userId: 'u123', username: 'john_trader', type: 'large_withdrawal', severity: 'high', status: 'new', description: 'Large withdrawal request ($500K) to unverified address', transactionAmount: '$500,000', createdAt: '2026-06-02T10:30:00Z' },
    { id: '2', userId: 'u456', username: 'crypto_king', type: 'kyc_pending', severity: 'medium', status: 'reviewing', description: 'KYC document verification pending for 48 hours', createdAt: '2026-06-02T08:15:00Z', assignedTo: 'admin1' },
    { id: '3', userId: 'u789', username: 'whale_trader', type: 'suspicious_activity', severity: 'critical', status: 'new', description: 'Multiple rapid deposits and withdrawals detected', transactionAmount: '$2.3M', createdAt: '2026-06-02T06:45:00Z' },
    { id: '4', userId: 'u234', username: 'new_user_2026', type: 'sanctions_screen', severity: 'low', status: 'pending', description: 'Address matches watchlist - needs review', createdAt: '2026-06-01T22:00:00Z' },
  ]);

  const [withdrawals] = useState<WithdrawalRequest[]>([
    { id: 'w1', userId: 'u123', username: 'john_trader', currency: 'BTC', amount: '5.4321', address: 'bc1q...xyz', status: 'pending', riskScore: 75, createdAt: '2026-06-02T10:30:00Z' },
    { id: 'w2', userId: 'u456', username: 'alice_in_crypto', currency: 'ETH', amount: '125.6789', address: '0x...abc', status: 'pending', riskScore: 25, createdAt: '2026-06-02T09:15:00Z' },
    { id: 'w3', userId: 'u789', username: 'btc_maxi', currency: 'USDT', amount: '250,000', address: '0x...def', status: 'pending', riskScore: 45, createdAt: '2026-06-02T08:00:00Z' },
  ]);

  const [users] = useState<AdminUser[]>([
    { id: 'u1', email: 'john@example.com', username: 'john_trader', kycLevel: 'advanced', status: 'active', riskLevel: 'low', balances: [{ currency: 'BTC', total: '1.5' }], createdAt: '2025-01-15', lastLogin: '2026-06-02', totalDeposits: '1,250,000', totalWithdrawals: '980,000', totalTrades: 1250, verificationStatus: 'verified' },
    { id: 'u2', email: 'alice@example.com', username: 'alice_in_crypto', kycLevel: 'intermediate', status: 'active', riskLevel: 'medium', balances: [{ currency: 'ETH', total: '25.5' }], createdAt: '2025-06-20', lastLogin: '2026-06-02', totalDeposits: '250,000', totalWithdrawals: '180,000', totalTrades: 450, verificationStatus: 'verified' },
    { id: 'u3', email: 'bob@example.com', username: 'btc_maxi', kycLevel: 'advanced', status: 'restricted', riskLevel: 'high', balances: [{ currency: 'USDT', total: '500,000' }], createdAt: '2024-11-10', lastLogin: '2026-06-01', totalDeposits: '5,000,000', totalWithdrawals: '4,500,000', totalTrades: 3200, verificationStatus: 'verified' },
  ]);

  const [auditLogs] = useState<AuditLog[]>([
    { id: 'a1', action: 'User KYC Approved', userId: 'admin@admin.com', targetType: 'user', targetId: 'u123', ip: '192.168.1.1', userAgent: 'Chrome/120', details: 'KYC level upgraded to Advanced', createdAt: '2026-06-02T11:00:00Z' },
    { id: 'a2', action: 'Withdrawal Approved', userId: 'admin@admin.com', targetType: 'withdrawal', targetId: 'w123', ip: '192.168.1.2', userAgent: 'Chrome/120', details: 'Withdrawal of 1.5 BTC approved', createdAt: '2026-06-02T10:45:00Z' },
    { id: 'a3', action: 'Market Trading Disabled', userId: 'admin@admin.com', targetType: 'market', targetId: 'DOGE/USDT', ip: '192.168.1.3', userAgent: 'Chrome/120', details: 'Trading disabled for maintenance', createdAt: '2026-06-02T10:30:00Z' },
    { id: 'a4', action: 'User Account Frozen', userId: 'admin@admin.com', targetType: 'user', targetId: 'u789', ip: '192.168.1.4', userAgent: 'Chrome/120', details: 'Account frozen due to suspicious activity', createdAt: '2026-06-02T10:15:00Z' },
  ]);

  const sections = [
    { id: 'dashboard', label: 'Dashboard', icon: <BarChart3 className="w-5 h-5" /> },
    { id: 'users', label: 'Users', icon: <Users className="w-5 h-5" /> },
    { id: 'compliance', label: 'Compliance', icon: <Shield className="w-5 h-5" /> },
    { id: 'transactions', label: 'Transactions', icon: <DollarSign className="w-5 h-5" /> },
    { id: 'markets', label: 'Markets', icon: <TrendingUp className="w-5 h-5" /> },
    { id: 'orders', label: 'Orders', icon: <Activity className="w-5 h-5" /> },
    { id: 'audit', label: 'Audit Log', icon: <Shield className="w-5 h-5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 z-40 transition-all ${
        sidebarOpen ? 'w-64' : 'w-16'
      }`}>
        <div className="h-14 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-800">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">T</span>
              </div>
              <span className="font-bold text-lg text-gray-900 dark:text-white">TigerEx</span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            {sidebarOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
        
        <nav className="p-2 space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                activeSection === section.id
                  ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-600'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {section.icon}
              {sidebarOpen && <span className="text-sm font-medium">{section.label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className={`transition-all ${sidebarOpen ? 'ml-64' : 'ml-16'}`}>
        {/* Header */}
        <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white capitalize">
              {activeSection === 'audit' ? 'Audit Log' : activeSection}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg relative">
              <Bell className="w-5 h-5 text-gray-500" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            <div className="flex items-center gap-2 pl-4 border-l border-gray-200 dark:border-gray-700">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                A
              </div>
              {sidebarOpen && (
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">Admin</div>
                  <div className="text-xs text-gray-500">Super Admin</div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="p-6">
          {activeSection === 'dashboard' && (
            <div className="space-y-6">
              <PlatformOverview />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SystemHealth />
                <RecentAlerts alerts={alerts} />
              </div>
              <PendingApprovals items={withdrawals} />
            </div>
          )}

          {activeSection === 'users' && (
            <div className="space-y-6">
              <UserManagement users={users} />
            </div>
          )}

          {activeSection === 'markets' && (
            <div className="space-y-6">
              <MarketManagement />
              <FeeManagement />
            </div>
          )}

          {activeSection === 'audit' && (
            <div className="space-y-6">
              <AuditLogViewer logs={auditLogs} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default AdminDashboard;