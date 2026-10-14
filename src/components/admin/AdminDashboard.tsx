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
  AlertCircle, Info, CheckCircle, XCircle, HelpCircle
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

// Admin information must be sourced from authenticated, authoritative services.
const PlatformOverview: React.FC = () => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500">
    Live platform metrics are unavailable because the admin metrics service is not connected.
  </div>
);

const SystemHealth: React.FC = () => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500">
    Live service telemetry is unavailable. System health is not inferred.
  </div>
);

const RecentAlerts: React.FC<{ alerts: ComplianceAlert[] }> = ({ alerts }) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500">
    {alerts.length ? `${alerts.length} live alerts loaded.` : 'No live compliance alerts are available.'}
  </div>
);

const PendingApprovals: React.FC<{ items: WithdrawalRequest[] }> = ({ items }) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500">
    {items.length ? `${items.length} live withdrawal requests loaded.` : 'No live withdrawal requests are available.'}
  </div>
);

const UserManagement: React.FC<{ users: AdminUser[] }> = ({ users }) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500">
    {users.length ? `${users.length} live user records loaded.` : 'User records are unavailable until the authenticated admin API is connected.'}
  </div>
);

const AuditLogViewer: React.FC<{ logs: AuditLog[] }> = ({ logs }) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500">
    {logs.length ? `${logs.length} live audit events loaded.` : 'Audit events are unavailable until the persistent audit service is connected.'}
  </div>
);

const MarketManagement: React.FC = () => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500">
    Market management is unavailable until the authenticated market configuration service is connected.
  </div>
);

const FeeManagement: React.FC = () => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-sm text-gray-500">
    Fee tiers are unavailable until persisted fee configuration is connected.
  </div>
);

// =============================================================================
// MAIN ADMIN DASHBOARD
// =============================================================================

export function AdminDashboard() {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // These lists stay empty until authoritative admin services supply live records.
  const [alerts] = useState<ComplianceAlert[]>([]);
  const [withdrawals] = useState<WithdrawalRequest[]>([]);
  const [users] = useState<AdminUser[]>([]);
  const [auditLogs] = useState<AuditLog[]>([]);

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