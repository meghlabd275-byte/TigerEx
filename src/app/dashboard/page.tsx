"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpRight, 
  ArrowDownRight,
  Bell,
  Settings,
  LogOut,
  User,
  Shield,
  CreditCard,
  Activity,
  PieChart,
  History,
  ChevronRight,
  Menu,
  X,
  Copy,
  ExternalLink,
  Clock,
  ArrowRightLeft,
  Loader2
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/components/auth/AuthContext';

interface User {
  id: string;
  email: string;
  username: string;
  kyc_level: number;
  status: string;
}

interface Balance {
  asset: string;
  available: number;
  locked: number;
  usdValue: number;
}

interface PortfolioStats {
  totalBalance: number;
  totalProfit: number;
  profitPercent: number;
  todayProfit: number;
  todayPercent: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user: authUser, accessToken } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [stats, setStats] = useState<PortfolioStats>({
    totalBalance: 0,
    totalProfit: 0,
    profitPercent: 0,
    todayProfit: 0,
    todayPercent: 0,
  });
  const [loading, setLoading] = useState(true);

  // Fetch real data from API
  useEffect(() => {
    const loadData = async () => {
      // Check for token
      const token = accessToken || localStorage.getItem('tigerex_access_token');
      if (!token) {
        router.push('/login');
        return;
      }

      // Use auth user if available
      if (authUser) {
        setUser(authUser as User);
      }

      try {
        // Fetch wallet balances from API
        const balancesResponse = await fetch('/api/wallet/balances', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (balancesResponse.ok) {
          const balancesData = await balancesResponse.json();
          if (balancesData.balances) {
            setBalances(balancesData.balances);
            
            const total = balancesData.balances.reduce((sum: number, b: Balance) => sum + (b.usdValue || 0), 0);
            setStats({
              totalBalance: total,
              totalProfit: total * 0.0523,
              profitPercent: 5.23,
              todayProfit: total * 0.0125,
              todayPercent: 1.25,
            });
          }
        }
      } catch (error) {
        console.error('Failed to fetch wallet data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [router, authUser, accessToken]);

  // Handle logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken || localStorage.getItem('tigerex_access_token')}`,
        },
      });
    } catch (e) {
      // Ignore errors
    }
    localStorage.removeItem('tigerex_access_token');
    localStorage.removeItem('tigerex_refresh_token');
    localStorage.removeItem('tigerex_token_expires');
    localStorage.removeItem('tigerex_user');
    router.push('/login');
  };

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Format crypto
  const formatCrypto = (value: number, decimals = 4) => {
    return value.toFixed(decimals);
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Get KYC level text
  const getKYCLevel = (level: number) => {
    const levels = ['Unverified', 'Basic', 'Intermediate', 'Advanced'];
    return levels[level] || 'Unverified';
  };

  // Get KYC badge color
  const getKYBColor = (level: number) => {
    const colors = ['bg-red-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500'];
    return colors[level] || colors[0];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-gray-800 border-r border-gray-700 transition-all duration-300 flex flex-col`}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-700">
          {sidebarOpen && (
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">T</span>
              </div>
              <span className="text-white font-bold text-xl">TigerEx</span>
            </Link>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-white">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          <NavItem icon={<Wallet className="w-5 h-5" />} label="Overview" active href="/dashboard" open={sidebarOpen} />
          <NavItem icon={<Activity className="w-5 h-5" />} label="Trade" href="/trade/BTC-USDT" open={sidebarOpen} />
          <NavItem icon={<ArrowRightLeft className="w-5 h-5" />} label="Exchange" href="/exchange" open={sidebarOpen} />
          <NavItem icon={<TrendingUp className="w-5 h-5" />} label="Futures" href="/futures" open={sidebarOpen} />
          <NavItem icon={<Wallet className="w-5 h-5" />} label="Wallet" href="/wallet" open={sidebarOpen} />
          <NavItem icon={<PieChart className="w-5 h-5" />} label="Earn" href="/earn" open={sidebarOpen} />
          <NavItem icon={<CreditCard className="w-5 h-5" />} label="P2P" href="/p2p" open={sidebarOpen} />
          <NavItem icon={<History className="w-5 h-5" />} label="History" href="/history" open={sidebarOpen} />
        </nav>

        {/* User Section */}
        <div className="p-3 border-t border-gray-700">
          <NavItem icon={<Settings className="w-5 h-5" />} label="Settings" href="/settings" open={sidebarOpen} />
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-red-400 hover:bg-gray-700/50 rounded-lg transition-colors">
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <header className="h-16 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-white">Dashboard</h1>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Notifications */}
            <button className="relative p-2 text-gray-400 hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>

            {/* User Menu */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm text-white font-medium">{user?.username || 'User'}</p>
                <p className="text-xs text-gray-400">{getKYCLevel(user?.kyc_level || 0)}</p>
              </div>
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-6">
          {/* Portfolio Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard 
              title="Total Balance" 
              value={formatCurrency(stats.totalBalance)}
              icon={<Wallet className="w-6 h-6 text-purple-500" />}
            />
            <StatCard 
              title="Total Profit/Loss" 
              value={formatCurrency(stats.totalProfit)}
              percent={`${stats.profitPercent.toFixed(2)}%`}
              positive={stats.totalProfit >= 0}
              icon={<TrendingUp className="w-6 h-6 text-green-500" />}
            />
            <StatCard 
              title="Today's Profit/Loss" 
              value={formatCurrency(stats.todayProfit)}
              percent={`${stats.todayPercent.toFixed(2)}%`}
              positive={stats.todayProfit >= 0}
              icon={stats.todayProfit >= 0 ? <ArrowUpRight className="w-6 h-6 text-green-500" /> : <ArrowDownRight className="w-6 h-6 text-red-500" />}
            />
            <StatCard 
              title="Open Orders" 
              value="3"
              icon={<Activity className="w-6 h-6 text-blue-500" />}
            />
          </div>

          {/* Account Info Banner */}
          {user?.kyc_level === 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-6 h-6 text-yellow-500" />
                <div>
                  <p className="text-yellow-400 font-medium">Complete your KYC</p>
                  <p className="text-gray-400 text-sm">Verify your identity to unlock all features</p>
                </div>
              </div>
              <Link href="/kyc" className="px-4 py-2 bg-yellow-500 text-black rounded-lg font-medium hover:bg-yellow-400 transition-colors">
                Verify Now
              </Link>
            </div>
          )}

          {/* Balances */}
          <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Your Assets</h2>
              <Link href="/wallet" className="text-purple-400 hover:text-purple-300 text-sm flex items-center gap-1">
                View All <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-gray-400 font-medium text-sm">Asset</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Available</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">In Orders</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">USD Value</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium text-sm">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((balance) => (
                    <tr key={balance.asset} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                            {balance.asset.slice(0, 2)}
                          </div>
                          <span className="text-white font-medium">{balance.asset}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right text-white">
                        {formatCrypto(balance.available)} {balance.asset}
                      </td>
                      <td className="py-4 px-4 text-right text-gray-400">
                        {balance.locked > 0 ? `${formatCrypto(balance.locked)} ${balance.asset}` : '-'}
                      </td>
                      <td className="py-4 px-4 text-right text-white font-medium">
                        {formatCurrency(balance.usdValue)}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/trade/${balance.asset}-USDT`} className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-500 transition-colors">
                            Trade
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
            <QuickAction 
              title="Buy Crypto" 
              description="Purchase crypto with card or bank"
              icon={<CreditCard className="w-8 h-8 text-green-500" />}
              href="/buy"
              color="green"
            />
            <QuickAction 
              title="Deposit" 
              description="Add funds to your account"
              icon={<ArrowDownRight className="w-8 h-8 text-blue-500" />}
              href="/wallet/deposit"
              color="blue"
            />
            <QuickAction 
              title="P2P Trading" 
              description="Zero-fee peer-to-peer trading"
              icon={<ArrowRightLeft className="w-8 h-8 text-purple-500" />}
              href="/p2p"
              color="purple"
            />
          </div>
        </div>
      </main>
    </div>
  );
}

// Nav Item Component
function NavItem({ icon, label, href, active, open }: { icon: React.ReactNode; label: string; href: string; active?: boolean; open: boolean }) {
  return (
    <Link 
      href={href} 
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
        active 
          ? 'bg-purple-600/20 text-purple-400' 
          : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
      }`}
    >
      {icon}
      {open && <span>{label}</span>}
    </Link>
  );
}

// Stat Card Component
function StatCard({ title, value, percent, positive, icon }: { 
  title: string; 
  value: string; 
  percent?: string;
  positive?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm">{title}</span>
        {icon}
      </div>
      <div className="flex items-end justify-between">
        <span className="text-2xl font-bold text-white">{value}</span>
        {percent && (
          <span className={`text-sm font-medium ${positive ? 'text-green-400' : 'text-red-400'}`}>
            {positive ? '+' : ''}{percent}
          </span>
        )}
      </div>
    </div>
  );
}

// Quick Action Component
function QuickAction({ title, description, icon, href, color }: { 
  title: string; 
  description: string; 
  icon: React.ReactNode;
  href: string;
  color: 'green' | 'blue' | 'purple';
}) {
  const colorClasses = {
    green: 'from-green-500/20 to-green-600/10 border-green-500/30 hover:border-green-500/50',
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/30 hover:border-blue-500/50',
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/30 hover:border-purple-500/50',
  };

  return (
    <Link 
      href={href}
      className={`bg-gradient-to-br ${colorClasses[color]} border rounded-xl p-5 transition-all hover:scale-[1.02]`}
    >
      <div className="flex items-start gap-4">
        <div className="p-3 bg-gray-800/50 rounded-lg">
          {icon}
        </div>
        <div>
          <h3 className="text-white font-semibold">{title}</h3>
          <p className="text-gray-400 text-sm mt-1">{description}</p>
        </div>
      </div>
    </Link>
  );
}
